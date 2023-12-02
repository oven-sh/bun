#include "App.h"

/* Note that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support */

int main() {
	/* The SSL context given in SSLApp constructor is the default / catch-all context */
	uWS::SSLApp app = uWS::SSLApp({
	  .key_file_name = "misc/key.pem",
	  .cert_file_name = "misc/cert.pem",
	  .passphrase = "1234"
	}).get("/*", [](auto *res, auto */*req*/) {
	    res->end("Hello from catch-all context!");
	}).addServerName("*.google.*", {
	  /* Following is the context for *.google.* domain */
	  .key_file_name = "misc/key.pem",
	  .cert_file_name = "misc/cert.pem",
	  .passphrase = "1234"
	}).domain("*.google.*").get("/*", [](auto *res, auto */*req*/) {
	    res->end("Hello from *.google.* context!");
	}).listen(3000, [](auto *listenSocket) {
	    if (listenSocket) {
			std::cout << "Listening on port " << 3000 << std::endl;
	    } else {
			std::cout << "Failed to listen on port 3000" << std::endl;
		}
	}).run();
}
