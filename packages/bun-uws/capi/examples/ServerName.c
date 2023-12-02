#include "../libuwebsockets.h"
#include <stdio.h>
#include <string.h>
#define SSL 1


struct us_listen_socket_t *globalListenSocket;
uws_app_t *app;
void get_handler(uws_res_t *res, uws_req_t *req, void* user_data)
{
	
    uws_res_end(SSL, res, "Hello CAPI!", 11, false);
}

void exit_handler(uws_res_t *res, uws_req_t *req, void* user_data)
{
	uws_res_end(SSL, res, "Shutting down!",14, false);
    /* We use this to check graceful closedown */
    us_listen_socket_close(false, globalListenSocket);
}

void missing_server_name_handler(const char *hostname,  void* user_data){
	printf("We are missing server name: <%s>\n", hostname);
	
	/* Assume it is localhost, so add it */
	uws_add_server_name(SSL, app, "localhost");
}

void listen_handler(struct us_listen_socket_t *listen_socket, uws_app_listen_config_t config, void* user_data)
{
    if (listen_socket){
        printf("Listening on port https://localhost:%d\n", config.port);
		globalListenSocket = listen_socket;
    }else{
		printf("Failed to listen on port https://localhost:%d\n", config.port);
	}
	
}

int main()
{
  	/* Overly simple hello world app (SNI)*/

    app = uws_create_app(SSL, (struct us_socket_context_options_t){
        /* There are example certificates in uWebSockets.js repo */
	    .key_file_name = "../misc/key.pem",
	    .cert_file_name = "../misc/cert.pem",
	    .passphrase = "1234"
    });    
	uws_missing_server_name(SSL, app, missing_server_name_handler, NULL);
	uws_app_get(SSL, app, "/*", get_handler, NULL);
	uws_app_get(SSL, app, "/exit", exit_handler, NULL);
    uws_app_listen(SSL, app, 3000, listen_handler, NULL);
    
	/* Let's add a wildcard SNI to begin with */
	uws_add_server_name(SSL, app, "*.google.*");

	uws_app_run(SSL, app);
}