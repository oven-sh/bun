#ifdef LIBUS_USE_QUIC

/* Do not rely on this API, it will change */
#include "Http3App.h"
#include <iostream>
#include <fstream>

/* This is an example serving a video over HTTP3, and echoing posted data back */
/* Todo: use onWritable and tryEnd instead of end */
int main() {

	/* Read video file to memory */
	std::ifstream file("video.mp4", std::ios::binary | std::ios::ate);
	std::streamsize size = file.tellg();
	file.seekg(0, std::ios::beg);

	std::vector<char> buffer(size);
	if (!file.read(buffer.data(), size)) {
		std::cout << "Failed to load video.mp4" << std::endl;
		return 0;
	}

	/* We need a bootstrapping server that instructs
	 * the web browser to use HTTP3 */
	(*new uWS::SSLApp({
	  .key_file_name = "misc/key.pem",
	  .cert_file_name = "misc/cert.pem",
	  .passphrase = "1234"
	})).get("/*", [&buffer](auto *res, auto *req) {
		res->writeHeader("Alt-Svc", "h3=\":9004\"");
		res->writeHeader("Alternative-Protocol", "quic:9004");
	    res->end("<html><h1>This is not HTTP3! Try refreshing (works in Firefox!)</h1></html>");
	}).listen(9004, [](auto *listen_socket) {
	    if (listen_socket) {
			std::cout << "Bootstrapping server Listening on port " << 9004 << std::endl;
	    }
	});

	/* And we serve the video over HTTP3 */
	uWS::H3App({
	  .key_file_name = "misc/key.pem",
	  .cert_file_name = "misc/cert.pem",
	  .passphrase = "1234"
	}).get("/*", [&buffer](auto *res, auto *req) {
	    res->end("<html><h1>Welcome to HTTP3! <a href=\"video.mp4\">Go see a movie</a></html></h1>");
	}).get("/video.mp4", [&buffer](auto *res, auto *req) {
		/* Send back a video */
	    res->end({&buffer[0], buffer.size()});
	}).post("/*", [](auto *res, auto *req) {

		std::cout << "Got POST request at " << req->getHeader(":path") << std::endl;

		/* You also need to set onAborted if receiving data */
		res->onData([res, bodyBuffer = (std::string *)nullptr](std::string_view chunk, bool isLast) mutable {
			if (isLast) {
				std::cout << "Sending back posted body now" << std::endl;
				if (bodyBuffer) {
					/* Send back the (chunked) body we got, as response */
					bodyBuffer->append(chunk);
					res->end(*bodyBuffer);
					delete bodyBuffer;
				} else {
					/* Send back the body we got, as response (fast path) */
					res->end(chunk);
				}
			} else {
				/* Slow path */
				if (!bodyBuffer) {
					bodyBuffer = new std::string;
				}
				/* If we got the body in a chunk, buffer it up until whole */
				bodyBuffer->append(chunk);
			}

		});

		/* If you have pending, asynch work, you should abort such work in this callback */
		res->onAborted([]() {
			/* Again, just printing is not enough, you need to abort any pending work here
			 * so that nothing will call res->end, since the request was aborted and deleted */
			printf("Stream was aborted!\n");
		});
	}).listen(9004, [](auto *listen_socket) {
	    if (listen_socket) {
			std::cout << "HTTP/3 server Listening on port " << 9004 << std::endl;
	    }
	}).run();

	std::cout << "Failed to listen on port 9004" << std::endl;
}

#else

#include <stdio.h>

int main() {
    printf("Compile with WITH_QUIC=1 WITH_BORINGSSL=1 make in order to build this example\n");
}

#endif