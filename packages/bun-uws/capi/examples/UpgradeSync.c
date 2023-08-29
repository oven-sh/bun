#include "../libuwebsockets.h"
#include <stdio.h>
#include <malloc.h>

#define SSL 1

/* This is a simple WebSocket "sync" upgrade example.
 * You may compile it with "WITH_OPENSSL=1 make" or with "make" */

/* uws_ws_get_user_data(ws) returns one of these */

struct PerSocketData
{
    /* Define your user data */
    int something;
};

void listen_handler(struct us_listen_socket_t *listen_socket, uws_app_listen_config_t config, void *user_data)
{
    if (listen_socket)
    {
        printf("Listening on port wss://localhost:%d\n", config.port);
    }
}

void upgrade_handler(uws_res_t *response, uws_req_t *request, uws_socket_context_t *context)
{

    /* You may read from req only here, and COPY whatever you need into your PerSocketData.
     * PerSocketData is valid from .open to .close event, accessed with uws_ws_get_user_data(ws).
     * HttpRequest (req) is ONLY valid in this very callback, so any data you will need later
     * has to be COPIED into PerSocketData here. */

    /* Immediately upgrading without doing anything "async" before, is simple */

    struct PerSocketData *data = (struct PerSocketData *)malloc(sizeof(struct PerSocketData));
    data->something = 15;

    const char *ws_key = NULL;
    const char *ws_protocol = NULL;
    const char *ws_extensions = NULL;
    
    size_t ws_key_length = uws_req_get_header(request, "sec-websocket-key", 17, &ws_key);
    size_t ws_protocol_length = uws_req_get_header(request, "sec-websocket-protocol", 22, &ws_protocol);
    size_t ws_extensions_length = uws_req_get_header(request, "sec-websocket-extensions", 24, &ws_extensions);

    uws_res_upgrade(SSL,
                    response,
                    (void *)data,
                    ws_key,
                    ws_key_length,
                    ws_protocol,
                    ws_protocol_length,
                    ws_extensions,
                    ws_extensions_length,
                    context);
}

void open_handler(uws_websocket_t *ws)
{

    /* Open event here, you may access uws_ws_get_user_data(ws) which points to a PerSocketData struct.
    * Here we simply validate that indeed, something == 15 as set in upgrade handler. */

    struct PerSocketData *data = (struct PerSocketData *)uws_ws_get_user_data(SSL, ws);
    data->something = 15;
    printf("Something is: %d\n", data->something);
}

void message_handler(uws_websocket_t *ws, const char *message, size_t length, uws_opcode_t opcode)
{
    /* We simply echo whatever data we get */
    uws_ws_send(SSL, ws, message, length, opcode);
}

void close_handler(uws_websocket_t *ws, int code, const char *message, size_t length)
{

    /* You may access uws_ws_get_user_data(ws) here, but sending or
     * doing any kind of I/O with the socket is not valid. */
    struct PerSocketData *data = (struct PerSocketData *)uws_ws_get_user_data(SSL, ws);
    if (data)
        free(data);
}

void drain_handler(uws_websocket_t *ws)
{
    /* Check uws_ws_get_buffered_amount(ws) here */
}

void ping_handler(uws_websocket_t *ws, const char *message, size_t length)
{
    /* You don't need to handle this one, we automatically respond to pings as per standard */
}

void pong_handler(uws_websocket_t *ws, const char *message, size_t length)
{

    /* You don't need to handle this one either */
}

int main()
{

    uws_app_t *app = uws_create_app(SSL, (struct us_socket_context_options_t){
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
    });

    uws_ws(SSL, app, "/*", (uws_socket_behavior_t){.compression = uws_compress_options_t::SHARED_COMPRESSOR, .maxPayloadLength = 16 * 1024, .idleTimeout = 12, .maxBackpressure = 1 * 1024 * 1024, .upgrade = upgrade_handler, .open = open_handler, .message = message_handler, .drain = drain_handler, .ping = ping_handler, .pong = pong_handler, .close = close_handler});

    uws_app_listen(SSL, app, 9001, listen_handler, NULL);

    uws_app_run(SSL, app);
}