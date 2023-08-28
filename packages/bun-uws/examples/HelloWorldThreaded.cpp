#include "App.h"
#include <thread>
#include <algorithm>
#include <mutex>

/* Note that SSL is disabled unless you build with WITH_OPENSSL=1 */
const int SSL = 1;
std::mutex stdoutMutex;

int main() {
    /* Overly simple hello world app, using multiple threads */
    std::vector<std::thread *> threads(std::thread::hardware_concurrency());

    std::transform(threads.begin(), threads.end(), threads.begin(), [](std::thread */*t*/) {
        return new std::thread([]() {

            uWS::SSLApp({
                .key_file_name = "misc/key.pem",
                .cert_file_name = "misc/cert.pem",
                .passphrase = "1234"
            }).get("/*", [](auto *res, auto * /*req*/) {
                res->end("Hello world!");
            }).listen(3000, [](auto *listen_socket) {
		stdoutMutex.lock();
                if (listen_socket) {
                    /* Note that us_listen_socket_t is castable to us_socket_t */
                    std::cout << "Thread " << std::this_thread::get_id() << " listening on port " << us_socket_local_port(SSL, (struct us_socket_t *) listen_socket) << std::endl;
                } else {
                    std::cout << "Thread " << std::this_thread::get_id() << " failed to listen on port 3000" << std::endl;
                }
		stdoutMutex.unlock();
            }).run();

        });
    });

    std::for_each(threads.begin(), threads.end(), [](std::thread *t) {
        t->join();
    });
}
