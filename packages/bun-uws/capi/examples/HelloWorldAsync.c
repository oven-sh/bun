#include "../libuwebsockets.h"
#include "libusockets.h"

#include <stdio.h>
#include <malloc.h>
#include <string.h>

#define SSL 0

typedef struct {
    uws_res_t* res;
    bool aborted;
} async_request_t;

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

void on_res_aborted(uws_res_t *response, void* data){
    async_request_t* request_data =  (async_request_t*)data;
    /* We don't implement any kind of cancellation here,
     * so simply flag us as aborted */
    request_data->aborted = true;
}

void on_res_corked(uws_res_t *response, void* data){
    uws_res_end(SSL, response, "Hello CAPI!", 11, false);
}
void on_timer_done(void *data){
    async_request_t* request_data = (async_request_t*)data;
    /* Were'nt we aborted before our async task finished? Okay, send a message! */
    if(!request_data->aborted){

        uws_res_cork(SSL, request_data->res,on_res_corked, request_data);
    }
}

void get_handler(uws_res_t *res, uws_req_t *req,  void* user_data)
{

    /* We have to attach an abort handler for us to be aware
     * of disconnections while we perform async tasks */
    async_request_t* request_data = (async_request_t*) malloc(sizeof(async_request_t));
    request_data->res = res;
    request_data->aborted = false;

    uws_res_on_aborted(SSL, res, on_res_aborted, request_data);

   /* Simulate checking auth for 5 seconds. This looks like crap, never write
    * code that utilize us_timer_t like this; they are high-cost and should
    * not be created and destroyed more than rarely!
    * Either way, here we go!*/
    uws_create_timer(1, 0, on_timer_done, request_data);
}


void listen_handler(struct us_listen_socket_t *listen_socket, uws_app_listen_config_t config,  void* user_data)
{
    if (listen_socket)
    {
        printf("Listening on port https://localhost:%d now\n", config.port);
    }
}

int main()
{
  	/* Overly simple hello world app with async response */


    uws_app_t *app = uws_create_app(SSL, (struct us_socket_context_options_t){
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
    });
    uws_app_get(SSL, app, "/*", get_handler, NULL);
    uws_app_listen(SSL, app, 3000, listen_handler, NULL);
    uws_app_run(SSL, app);
}
