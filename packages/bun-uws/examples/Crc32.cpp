#include "App.h"

/* This is a good example for testing and showing the POST requests.
 * Anything you post (either with content-length or using transfer-encoding: chunked) will
 * be hashed with crc32 and sent back in the response. This example also shows how to deal with
 * aborted requests. */

/* curl -H "Transfer-Encoding: chunked" --data-binary @video.mp4 http://localhost:3000 */
/* curl --data-binary @video.mp4 http://localhost:3000 */
/* crc32 video.mp4 */

/* Note that uWS::SSLApp({options}) is the same as uWS::App() when compiled without SSL support */

#include <sstream>
#include <cstdint>
#include <cstddef>

uint32_t crc32(const char *s, size_t n, uint32_t crc = 0xFFFFFFFF) {

    for (size_t i = 0; i < n; i++) {
        unsigned char ch = static_cast<unsigned char>(s[i]);
        for (size_t j = 0; j < 8; j++) {
            uint32_t b = (ch ^ crc) & 1;
            crc >>= 1;
            if (b) crc = crc ^ 0xEDB88320;
            ch >>= 1;
        }
    }

    return crc;
}

int main() {

	uWS::SSLApp({
	  .key_file_name = "misc/key.pem",
	  .cert_file_name = "misc/cert.pem",
	  .passphrase = "1234"
	}).post("/*", [](auto *res, auto *req) {

		/* Display the headers */
		std::cout << " --- " << req->getUrl() << " --- " << std::endl;
		for (auto [key, value] : *req) {
			std::cout << key << ": " << value << std::endl;
		}

		auto isAborted = std::make_shared<bool>(false);
		uint32_t crc = 0xFFFFFFFF;
		res->onData([res, isAborted, crc](std::string_view chunk, bool isFin) mutable {
			if (chunk.length()) {
				crc = crc32(chunk.data(), chunk.length(), crc);
			}

			if (isFin && !*isAborted) {
				std::stringstream s;
    			s << std::hex << (~crc) << std::endl;
				res->end(s.str());
			}
		});

		res->onAborted([isAborted]() {
			*isAborted = true;
		});
	}).listen(3000, [](auto *listen_socket) {
	    if (listen_socket) {
			std::cerr << "Listening on port " << 3000 << std::endl;
	    }
	}).run();

	std::cout << "Failed to listen on port 3000" << std::endl;
}
