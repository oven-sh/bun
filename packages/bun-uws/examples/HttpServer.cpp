/* This is a simple HTTP(S) web server much like Python's SimpleHTTPServer */

#include <App.h>

/* Helpers for this example */
#include "helpers/AsyncFileReader.h"
#include "helpers/AsyncFileStreamer.h"
#include "helpers/Middleware.h"

/* optparse */
#define OPTPARSE_IMPLEMENTATION
#include "helpers/optparse.h"

int main(int argc, char **argv) {

    int option;
    struct optparse options;
    optparse_init(&options, argv);

    struct optparse_long longopts[] = {
        {"port", 'p', OPTPARSE_REQUIRED},
        {"help", 'h', OPTPARSE_NONE},
        {"passphrase", 'a', OPTPARSE_REQUIRED},
        {"key", 'k', OPTPARSE_REQUIRED},
        {"cert", 'c', OPTPARSE_REQUIRED},
        {"dh_params", 'd', OPTPARSE_REQUIRED},
        {0}
    };

    int port = 3000;
    struct us_socket_context_options_t ssl_options = {};

    while ((option = optparse_long(&options, longopts, nullptr)) != -1) {
        switch (option) {
        case 'p':
            port = atoi(options.optarg);
            break;
        case 'a':
            ssl_options.passphrase = options.optarg;
            break;
        case 'c':
            ssl_options.cert_file_name = options.optarg;
            break;
        case 'k':
            ssl_options.key_file_name = options.optarg;
            break;
        case 'd':
            ssl_options.dh_params_file_name = options.optarg;
            break;
        case 'h':
        case '?':
            fail:
            std::cout << "Usage: " << argv[0] << " [--help] [--port <port>] [--key <ssl key>] [--cert <ssl cert>] [--passphrase <ssl key passphrase>] [--dh_params <ssl dh params file>] <public root>" << std::endl;
            return 0;
        }
    }

    char *root = optparse_arg(&options);
    if (!root) {
        goto fail;
    }

    AsyncFileStreamer asyncFileStreamer(root);

    /* Either serve over HTTP or HTTPS */
    struct us_socket_context_options_t empty_ssl_options = {};
    if (memcmp(&ssl_options, &empty_ssl_options, sizeof(empty_ssl_options))) {
        /* HTTPS */
        uWS::SSLApp(ssl_options).get("/*", [&asyncFileStreamer](auto *res, auto *req) {
            serveFile(res, req);
            asyncFileStreamer.streamFile(res, req->getUrl());
        }).listen(port, [port, root](auto *token) {
            if (token) {
                std::cout << "Serving " << root << " over HTTPS a " << port << std::endl;
            }
        }).run();
    } else {
        /* HTTP */
        uWS::App().get("/*", [&asyncFileStreamer](auto *res, auto *req) {
            serveFile(res, req);
            asyncFileStreamer.streamFile(res, req->getUrl());
        }).listen(port, [port, root](auto *token) {
            if (token) {
                std::cout << "Serving " << root << " over HTTP a " << port << std::endl;
            }
        }).run();
    }

    std::cout << "Failed to listen to port " << port << std::endl;
}
