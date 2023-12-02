// This example is broken and doesn't do anything. It is a potential interface for a future potential client.

#include "ClientApp.h"
#include <iostream>

int main() {
    uWS::ClientApp app({
        .open = [](/*auto *ws*/) {
            std::cout << "Hello and welcome to client" << std::endl;
        },
        .message = [](/*auto *ws, auto message*/) {

        },
        .close = [](/*auto *ws*/) {
            std::cout << "bye" << std::endl;
        }
    });
    
    app.connect("ws://localhost:3000", "protocol");
    
    app.run();
}
