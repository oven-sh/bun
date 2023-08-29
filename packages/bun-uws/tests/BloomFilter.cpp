#include "../src/BloomFilter.h"

#include <cassert>
#include <vector>
#include <string>
#include <algorithm>
#include <iostream>

/* From Wikipedia */
std::vector<std::string> commonHeaders = {
    "A-IM",
    "Accept",
    "Accept-Charset",
    "Accept-Datetime",
    "Accept-Encoding",
    "Accept-Language",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
    "Authorization",
    "Cache-Control",
    "Connection",
    "Content-Encoding",
    "Content-Length",
    "Content-MD5",
    "Content-Type",
    "Cookie",
    "Date",
    "Expect",
    "Forwarded",
    "From",
    "Host",
    "HTTP2-Settings",
    "If-Match",
    "If-Modified-Since",
    "If-None-Match",
    "If-Range",
    "If-Unmodified-Since",
    "Max-Forwards",
    "Origin",
    "Pragma",
    "Proxy-Authorization",
    "Range",
    "Referer",
    "TE",
    "Trailer",
    "Transfer-Encoding",
    "User-Agent",
    "Upgrade",
    "Via",
    "Warning",

    /* Put common non-standard ones here */
};

int main() {

    /* Lowercase everything */
    std::transform(commonHeaders.begin(), commonHeaders.end(), commonHeaders.begin(), [](std::string &header) {
        std::transform(header.begin(), header.end(), header.begin(), ::tolower);
        return header;
    });

    uWS::BloomFilter bf;
    unsigned int totalCollisions = 0;

    /* One on one */
    for (int i = 0; i < commonHeaders.size(); i++) {
        bf.reset();
        assert(bf.mightHave(commonHeaders[i]) == false);

        bf.add(commonHeaders[i]);
        assert(bf.mightHave(commonHeaders[i]) == true);

        for (int j = i + 1; j < commonHeaders.size(); j++) {
            if (bf.mightHave(commonHeaders[j])) {
                std::cout << commonHeaders[i] << " collides with " << commonHeaders[j] << std::endl;
                totalCollisions++;
            }
        }
    }

    /* We don't want any direct one-one-one collisions (please) */
    std::cout << "Total collisions: " << totalCollisions << std::endl;
    assert(totalCollisions == 0);

    unsigned int totalFalsePositives = 0;

    /* Add all except the one we test */
    for (int i = 0; i < commonHeaders.size(); i++) {
        bf.reset();

        /* Add all headers but our */
        for (int j = 0; j < commonHeaders.size(); j++) {
            if (j != i) {
                bf.add(commonHeaders[j]);
            }
        }

        /* Do we have false positives? */
        if (bf.mightHave(commonHeaders[i])) {
            std::cout << commonHeaders[i] << " has false positives" << std::endl;
            totalFalsePositives++;
        }
    }

    /* It is totally fine to have a few false positives */
    std::cout << "Total false positives: " << totalFalsePositives << std::endl;
    assert(totalFalsePositives == 0);
}
