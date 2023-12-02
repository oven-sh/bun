#include "../libuwebsockets.h"
#include "libusockets.h"
#include <stdio.h>

#define SSL 1

void get_handler(uws_res_t *res, uws_req_t *req, void *user_data)
{
    uws_res_end(SSL, res, "Hello CAPI!", 11, false);
}

void listen_handler(struct us_listen_socket_t *listen_socket, uws_app_listen_config_t config, void *user_data)
{
    if (listen_socket)
    {
        printf("Listening on port https://localhost:%d now\n", config.port);
    }
}

int main()
{
    /* Overly simple hello world app */

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
