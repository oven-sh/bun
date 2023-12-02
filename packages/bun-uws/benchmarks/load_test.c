/* This is a simple yet efficient WebSocket server benchmark much like WRK */

#define _BSD_SOURCE

#ifdef __APPLE__
#include <libkern/OSByteOrder.h>

#define htobe16(x) OSSwapHostToBigInt16(x)
#define htole16(x) OSSwapHostToLittleInt16(x)
#define be16toh(x) OSSwapBigToHostInt16(x)
#define le16toh(x) OSSwapLittleToHostInt16(x)

#define htobe32(x) OSSwapHostToBigInt32(x)
#define htole32(x) OSSwapHostToLittleInt32(x)
#define be32toh(x) OSSwapBigToHostInt32(x)
#define le32toh(x) OSSwapLittleToHostInt32(x)

#define htobe64(x) OSSwapHostToBigInt64(x)
#define htole64(x) OSSwapHostToLittleInt64(x)
#define be64toh(x) OSSwapBigToHostInt64(x)
#define le64toh(x) OSSwapLittleToHostInt64(x)
#else
#include <endian.h>
#endif


#include <stdint.h>

#include <libusockets.h>
int SSL;

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Whatever type we selected (compressed or not) */
unsigned char *web_socket_request;
int web_socket_request_size;

char *upgrade_request;
int upgrade_request_length;

/* Compressed message */
unsigned char web_socket_request_deflate[13] = {
    130 | 64, 128 | 7,
    0, 0, 0, 0,
    0xf2, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00
};

/* Not compressed */
unsigned char web_socket_request_text_small[26] = {130, 128 | 20, 1, 2, 3, 4};
unsigned int web_socket_request_text_size = 26;
unsigned char *web_socket_request_text = web_socket_request_text_small;

/* Called to swap from small text message to big text message */
void init_big_message(unsigned int size) {
    if (size < 65536) {
        printf("Error: message size must be bigger\n");
        exit(0);
    }

    web_socket_request_text_size = size + 6 + 8;

    web_socket_request_text = malloc(web_socket_request_text_size);
    web_socket_request_text[0] = 130;
    web_socket_request_text[1] = 255;
    uint64_t msg_size = htobe64(size);
    memcpy(&web_socket_request_text[2], &msg_size, 8);
    web_socket_request_text[10] = 1;
    web_socket_request_text[10] = 2;
    web_socket_request_text[10] = 3;
    web_socket_request_text[10] = 4;
}

void init_medium_message(unsigned int size) {
    if (size > 65536) {
        printf("Error: message size must be smaller\n");
        exit(0);
    }

    web_socket_request_text_size = size + 6 + 2; // 8 for big

    web_socket_request_text = malloc(web_socket_request_text_size);
    web_socket_request_text[0] = 130;
    web_socket_request_text[1] = 254;
    uint16_t msg_size = htobe16(size);
    memcpy(&web_socket_request_text[2], &msg_size, 2);
    web_socket_request_text[4] = 1;
    web_socket_request_text[5] = 2;
    web_socket_request_text[6] = 3;
    web_socket_request_text[7] = 4;
}

char request_deflate[] = "GET / HTTP/1.1\r\n"
                 "Upgrade: websocket\r\n"
                 "Connection: Upgrade\r\n"
                 "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n"
                 "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n"
                 "Host: server.example.com\r\n"
                 "Sec-WebSocket-Version: 13\r\n\r\n";

char request_text[] = "GET / HTTP/1.1\r\n"
                 "Upgrade: websocket\r\n"
                 "Connection: Upgrade\r\n"
                 "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n"
                 //"Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n"
                 "Host: server.example.com\r\n"
                 "Sec-WebSocket-Version: 13\r\n\r\n";
char *host;
int port;
int connections;

int responses;

struct http_socket {
    /* How far we have streamed our websocket request */
    int offset;

    /* How far we have streamed our upgrade request */
    int upgrade_offset;

    /* Whether or not we have received the upgrade response */
    int is_upgraded;

    /* How many bytes we expect to be echoed back to us before we consider the echo done */
    int outstanding_bytes;
};

/* We don't need any of these */
void on_wakeup(struct us_loop_t *loop) {

}

void on_pre(struct us_loop_t *loop) {

}

/* This is not HTTP POST, it is merely an event emitted post loop iteration */
void on_post(struct us_loop_t *loop) {

}

void next_connection(struct us_socket_t *s) {
    /* We could wait with this until properly upgraded */
    if (--connections) {
        us_socket_context_connect(SSL, us_socket_context(SSL, s), host, port, NULL, 0, sizeof(struct http_socket));
    } else {
        printf("Running benchmark now...\n");

        us_socket_timeout(SSL, s, LIBUS_TIMEOUT_GRANULARITY);
    }
}

struct us_socket_t *on_http_socket_writable(struct us_socket_t *s) {
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

    /* Are we still not upgraded yet? */
    if (http_socket->upgrade_offset < upgrade_request_length) {
        http_socket->upgrade_offset += us_socket_write(SSL, s, upgrade_request + http_socket->upgrade_offset, upgrade_request_length - http_socket->upgrade_offset, 0);

        /* Now we should be */
        if (http_socket->upgrade_offset == upgrade_request_length) {
            next_connection(s);
        }
    } else {
        /* Stream whatever is remaining of the request */
        http_socket->offset += us_socket_write(SSL, s, (char *) web_socket_request + http_socket->offset, web_socket_request_size - http_socket->offset, 0);
    }

    return s;
}

struct us_socket_t *on_http_socket_close(struct us_socket_t *s, int code, void *reason) {

    printf("Closed!\n");

    return s;
}

struct us_socket_t *on_http_socket_end(struct us_socket_t *s) {
    return us_socket_close(SSL, s, 0, NULL);
}

struct us_socket_t *on_http_socket_data(struct us_socket_t *s, char *data, int length) {
    /* Get socket extension and the socket's context's extension */
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);
    
    if (http_socket->is_upgraded) {

        /* If we are upgraded we now count to see if we receive the corect echo */
        http_socket->outstanding_bytes -= length;

        if (http_socket->outstanding_bytes == 0) {
            /* We got exactly the correct amount of bytes back, send another message */
            http_socket->offset = us_socket_write(SSL, s, (char *) web_socket_request, web_socket_request_size, 0);
            http_socket->outstanding_bytes = web_socket_request_size - 4;

            /* Increase stats */
            responses++;
        } else if (http_socket->outstanding_bytes < 0) {
            /* This should never happen */
            printf("ERROR: outstanding bytes negative!");
            exit(0);
        }
    } else {
        /* We assume the last 4 bytes will be delivered in one chunk */
        if (length >= 4 && memcmp(data + length - 4, "\r\n\r\n", 4) == 0) {
            /* We are upgraded so start sending the message for echoing */
            http_socket->offset = us_socket_write(SSL, s, (char *) web_socket_request, web_socket_request_size, 0);

            /* Server will echo back the same message minus 4 bytes for mask */
            http_socket->outstanding_bytes = web_socket_request_size - 4;
            http_socket->is_upgraded = 1;
        }
    }

    return s;
}

struct us_socket_t *on_http_socket_open(struct us_socket_t *s, int is_client, char *ip, int ip_length) {
    struct http_socket *http_socket = (struct http_socket *) us_socket_ext(SSL, s);

    /* Reset offsets */
    http_socket->offset = 0;

    http_socket->is_upgraded = 0;

    /* Send an upgrade request */
    http_socket->upgrade_offset = us_socket_write(SSL, s, upgrade_request, upgrade_request_length, 0);
    if (http_socket->upgrade_offset == upgrade_request_length) {
        next_connection(s);
    }

    return s;
}

struct us_socket_t *on_http_socket_timeout(struct us_socket_t *s) {
    /* Print current statistics */
    printf("Msg/sec: %f\n", ((float)responses) / LIBUS_TIMEOUT_GRANULARITY);

    responses = 0;
    us_socket_timeout(SSL, s, LIBUS_TIMEOUT_GRANULARITY);

    return s;
}

int main(int argc, char **argv) {

    /* Parse host and port */
    if (argc != 6 && argc != 7) {
        printf("Usage: connections host port ssl deflate [size_kb]\n");
        return 0;
    }

    port = atoi(argv[3]);
    host = malloc(strlen(argv[2]) + 1);
    memcpy(host, argv[2], strlen(argv[2]) + 1);
    connections = atoi(argv[1]);
    SSL = atoi(argv[4]);
    if (atoi(argv[5])) {
        /* Set up deflate */
        web_socket_request = web_socket_request_deflate;
        web_socket_request_size = sizeof(web_socket_request_deflate);

        upgrade_request = request_deflate;
        upgrade_request_length = sizeof(request_deflate) - 1;
    } else {
        /* Only if we are NOT using defalte can we support testing with 100mb for now */
        if (argc == 7) {
            int size_kb = atoi(argv[6]);
            printf("Using message size of %d kB\n", size_kb);

            /* Size has to be in KB since the minimal size for medium is 1kb */
            if (size_kb <= 64) {
                init_medium_message(size_kb * 1024);
            } else {      
                init_big_message(size_kb * 1024);
            }
        }

        web_socket_request = web_socket_request_text;
        web_socket_request_size = web_socket_request_text_size;

        upgrade_request = request_text;
        upgrade_request_length = sizeof(request_text) - 1;
    }

    /* Create the event loop */
    struct us_loop_t *loop = us_create_loop(0, on_wakeup, on_pre, on_post, 0);

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
