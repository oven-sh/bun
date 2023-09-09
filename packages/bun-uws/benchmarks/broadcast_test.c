/* This benchmark establishes _connections_ number of WebSocket
   clients, then iteratively performs the following:

   1. Send one message for every client.
   2. Wait for the quadratic (_connections_^2) amount of responses from the server.
   3. Once received all expected bytes, repeat by going to step 1.

   Every 4 seconds we print the current average "iterations per second".
   */

#include <libusockets.h>
int SSL;

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

unsigned char web_socket_request[26] = {130, 128 | 20, 1, 2, 3, 4};

char request[] = "GET / HTTP/1.1\r\n"
                 "Upgrade: websocket\r\n"
                 "Connection: Upgrade\r\n"
                 "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n"
                 "Host: server.example.com\r\n"
                 "Sec-WebSocket-Version: 13\r\n\r\n";
char *host;
int port;
int connections;

int satisfied_sockets;
int iterations;

struct http_socket {
    /* How far we have streamed our websocket request */
    int offset;

    /* How far we have streamed our upgrade request */
    int upgrade_offset;

    /* Are we upgraded? */
    int is_upgraded;

    /* Bytes received */
    int bytes_received;
};

/* We track upgraded websockets */
void **web_sockets;
int num_web_sockets;

/* We don't need any of these */
void noop(struct us_loop_t *loop) {

}

void start_iteration() {
    for (int i = 0; i < num_web_sockets; i++) {
        struct us_socket_t *s = (struct us_socket_t *) web_sockets[i];
        struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

        http_socket->offset = us_socket_write(SSL, s, (char *) web_socket_request, sizeof(web_socket_request), 0);
    }
}

void next_connection(struct us_socket_t *s) {
    /* Add this connection to our array */
    web_sockets[num_web_sockets++] = s;

    /* We could wait with this until properly upgraded */
    if (--connections) {
        us_socket_context_connect(SSL, us_socket_context(SSL, s), host, port, NULL, 0, sizeof(struct http_socket));
    } else {
        printf("Running benchmark now...\n");
        start_iteration();

        us_socket_timeout(SSL, s, LIBUS_TIMEOUT_GRANULARITY);
    }
}

struct us_socket_t *on_http_socket_writable(struct us_socket_t *s) {
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

    /* Are we still not upgraded yet? */
    if (http_socket->upgrade_offset < sizeof(request) - 1) {
        http_socket->upgrade_offset += us_socket_write(SSL, s, request + http_socket->upgrade_offset, sizeof(request) - 1 - http_socket->upgrade_offset, 0);
    } else {
        /* Stream whatever is remaining of the request */
        http_socket->offset += us_socket_write(SSL, s, (char *) web_socket_request + http_socket->offset, sizeof(web_socket_request) - http_socket->offset, 0);
    }

    return s;
}

struct us_socket_t *on_http_socket_close(struct us_socket_t *s, int code, void *reason) {

    printf("Client was disconnected, exiting!\n");
    exit(-1);

    return s;
}

struct us_socket_t *on_http_socket_end(struct us_socket_t *s) {
    return us_socket_close(SSL, s, 0, NULL);
}

struct us_socket_t *on_http_socket_data(struct us_socket_t *s, char *data, int length) {
    /* Get socket extension and the socket's context's extension */
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

    /* Are we already upgraded? */
    if (http_socket->is_upgraded) {
        http_socket->bytes_received += length;

        if (http_socket->bytes_received == (sizeof(web_socket_request) - 4) * num_web_sockets) {
            satisfied_sockets++;
            http_socket->bytes_received = 0;

            if (satisfied_sockets == num_web_sockets) {
                iterations++;
                satisfied_sockets = 0;

                start_iteration();
            }
        }
    } else {
        /* We assume the server is not sending anything immediately following upgrade and that we get rnrn in one chunk */
        if (length >= 4 && data[length - 1] == '\n' && data[length - 2] == '\r' && data[length - 3] == '\n' && data[length - 4] == '\r') {
            http_socket->is_upgraded = 1;
            next_connection(s);
        }
    }

    return s;
}

struct us_socket_t *on_http_socket_open(struct us_socket_t *s, int is_client, char *ip, int ip_length) {
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

    /* Reset offsets */
    http_socket->offset = 0;
    http_socket->is_upgraded = 0;
    http_socket->bytes_received = 0;

    /* Send an upgrade request */
    http_socket->upgrade_offset = us_socket_write(SSL, s, request, sizeof(request) - 1, 0);

    return s;
}

struct us_socket_t *on_http_socket_timeout(struct us_socket_t *s) {
    /* Print current statistics */
    printf("Iterations/second (%d clients): %f\n", num_web_sockets, ((float)iterations) / LIBUS_TIMEOUT_GRANULARITY);

    iterations = 0;
    us_socket_timeout(SSL, s, LIBUS_TIMEOUT_GRANULARITY);

    return s;
}

int main(int argc, char **argv) {

    /* Parse host and port */
    if (argc != 5) {
        printf("Usage: connections host port ssl\n");
        return 0;
    }

    port = atoi(argv[3]);
    host = malloc(strlen(argv[2]) + 1);
    memcpy(host, argv[2], strlen(argv[2]) + 1);
    connections = atoi(argv[1]);
    SSL = atoi(argv[4]);

    /* Allocate room for every socket */
    web_sockets = (void **) malloc(sizeof(void *) * connections);

    /* Create the event loop */
    struct us_loop_t *loop = us_create_loop(0, noop, noop, noop, 0);

    /* Create a socket context for HTTP */
    struct us_socket_context_options_t options = {};
    struct us_socket_context_t *http_context = us_create_socket_context(SSL, loop, 0, options);

    /* Set up event handlers */
    us_socket_context_on_open(SSL, http_context, on_http_socket_open);
    us_socket_context_on_data(SSL, http_context, on_http_socket_data);
    us_socket_context_on_writable(SSL, http_context, on_http_socket_writable);
    us_socket_context_on_close(SSL, http_context, on_http_socket_close);
    us_socket_context_on_timeout(SSL, http_context, on_http_socket_timeout);
    us_socket_context_on_end(SSL, http_context, on_http_socket_end);

    /* Start making HTTP connections */
    us_socket_context_connect(SSL, http_context, host, port, NULL, 0, sizeof(struct http_socket));

    us_loop_run(loop);
}
