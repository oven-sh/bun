#include "../libuwebsockets.h"
#include <stdio.h>
#include <malloc.h>
#include <time.h>
#include <string.h>
#include <stdarg.h>
#define SSL 1


//Timer close helper
void uws_timer_close(struct us_timer_t *timer)
{
    struct us_timer_t *t = (struct us_timer_t *)timer;
    struct timer_handler_data *data;
    memcpy(&data, us_timer_ext(t), sizeof(struct timer_handler_data *));
    free(data);
    us_timer_close(t);
}
//Timer create helper
struct us_timer_t *uws_create_timer(int ms, int repeat_ms, void (*handler)(void *data), void *data)
{
    struct us_loop_t *loop = uws_get_loop();
    struct us_timer_t *delayTimer = us_create_timer(loop, 0, sizeof(void *));

    struct timer_handler_data
    {
        void *data;
        void (*handler)(void *data);
        bool repeat;
    };

    struct timer_handler_data *timer_data = (struct timer_handler_data *)malloc(sizeof(timer_handler_data));
    timer_data->data = data;
    timer_data->handler = handler;
    timer_data->repeat = repeat_ms > 0;
    memcpy(us_timer_ext(delayTimer), &timer_data, sizeof(struct timer_handler_data *));

    us_timer_set(
        delayTimer, [](struct us_timer_t *t)
        {
            /* We wrote the pointer to the timer's extension */
            struct timer_handler_data *data;
            memcpy(&data, us_timer_ext(t), sizeof(struct timer_handler_data *));

            data->handler(data->data);

            if (!data->repeat)
            {
                free(data);
                us_timer_close(t);
            }
        },
        ms, repeat_ms);

    return (struct us_timer_t *)delayTimer;
}

/* This is a simple WebSocket "sync" upgrade example.
 * You may compile it with "WITH_OPENSSL=1 make" or with "make" */

/* ws->getUserData returns one of these */
struct PerSocketData {
    /* Fill with user data */
};

int buffer_size(const char* format, ...) {
    va_list args;
    va_start(args, format);
    int result = vsnprintf(NULL, 0, format, args);
    va_end(args);
    return result + 1; // safe byte for \0
}

void listen_handler(struct us_listen_socket_t *listen_socket, uws_app_listen_config_t config,  void* user_data)
{
    if (listen_socket){
        printf("Listening on port wss://localhost:%d\n", config.port);
    }
}

void open_handler(uws_websocket_t* ws){

     /* Open event here, you may access uws_ws_get_user_data(WS) which points to a PerSocketData struct */
    uws_ws_subscribe(SSL, ws, "broadcast", 9);
}

void message_handler(uws_websocket_t* ws, const char* message, size_t length, uws_opcode_t opcode){
}

void close_handler(uws_websocket_t* ws, int code, const char* message, size_t length){
    /* You may access uws_ws_get_user_data(ws) here, but sending or
     * doing any kind of I/O with the socket is not valid. */
}

void drain_handler(uws_websocket_t* ws){
    /* Check uws_ws_get_buffered_amount(ws) here */
}

void ping_handler(uws_websocket_t* ws, const char* message, size_t length){
    /* You don't need to handle this one, we automatically respond to pings as per standard */
}

void pong_handler(uws_websocket_t* ws, const char* message, size_t length){

    /* You don't need to handle this one either */
}

void on_timer_interval(void* data){

    // broadcast the unix time as millis

    uws_app_t * app = (uws_app_t *)data;
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);

    int64_t millis = ts.tv_sec * 1000 + ts.tv_nsec / 1000000;

    
    char* message = (char*)malloc((size_t)buffer_size("%ld", millis));
    size_t message_length = sprintf(message, "%ld", millis);

    uws_publish(SSL, app, "broadcast", 9, message, message_length, uws_opcode_t::TEXT, false);
    free(message);
}

int main()
{


    uws_app_t *app = uws_create_app(SSL, (struct us_socket_context_options_t){
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
    });

	uws_ws(SSL, app, "/*", (uws_socket_behavior_t){
		.compression = uws_compress_options_t::SHARED_COMPRESSOR,
        .maxPayloadLength = 16 * 1024,
        .idleTimeout = 12,
        .maxBackpressure = 1 * 1024 * 1024,
		.upgrade = NULL,
        .open = open_handler,
        .message = message_handler,
        .drain = drain_handler,
        .ping = ping_handler,
        .pong = pong_handler,
        .close = close_handler,
	});

    uws_app_listen(SSL, app, 9001, listen_handler, NULL);

    // broadcast the unix time as millis every 8 millis
    uws_create_timer(8, 8, on_timer_interval,  app);

	uws_app_run(SSL, app);
}