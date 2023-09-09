/* This is a fuzz test of the http parser */

#define WIN32_EXPORT

#include "helpers.h"

/* We test the websocket parser */
#include "../src/HttpParser.h"

/* And the router */
#include "../src/HttpRouter.h"

/* Also ProxyParser */
#include "../src/ProxyParser.h"

struct StaticData {

    struct RouterData {

    };

    uWS::HttpRouter<RouterData> router;

    StaticData() {

        router.add({"get"}, "/:hello/:hi", [](auto *h) mutable {
            auto [paramsTop, params] = h->getParameters();

            /* Something is horribly wrong */
            if (paramsTop != 1 || !params[0].length() || !params[1].length()) {
                exit(-1);
            }

            /* This route did handle it */
            return true;
        });

        router.add({"post"}, "/:hello/:hi/*", [](auto *h) mutable {
            auto [paramsTop, params] = h->getParameters();

            /* Something is horribly wrong */
            if (paramsTop != 1 || !params[0].length() || !params[1].length()) {
                exit(-1);
            }

            /* This route did handle it */
            return true;
        });

        router.add({"get"}, "/*", [](auto *h) mutable {
            auto [paramsTop, params] = h->getParameters();

            /* Something is horribly wrong */
            if (paramsTop != -1) {
                exit(-1);
            }

            /* This route did not handle it */
            return false;
        });

        router.add({"get"}, "/hi", [](auto *h) mutable {
            auto [paramsTop, params] = h->getParameters();

            /* Something is horribly wrong */
            if (paramsTop != -1) {
                exit(-1);
            }

            /* This route did handle it */
            return true;
        });
    }
} staticData;

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    /* Create parser */
    uWS::HttpParser httpParser;
    /* User data */
    void *user = (void *) 13;

    /* If we are built with WITH_PROXY, pass a ProxyParser as reserved */
    void *reserved = nullptr;
#ifdef UWS_WITH_PROXY
    uWS::ProxyParser pp;
    reserved = (void *) &pp;
#endif

    /* Iterate the padded fuzz as chunks */
    makeChunked(makePadded(data, size), size, [&httpParser, &user, reserved](const uint8_t *data, size_t size) {
        /* We need at least 1 byte post padding */
        if (size) {
            size--;
        } else {
            /* We might be given zero length chunks */
            return;
        }

        /* If user is null then ignore this chunk */
        if (!user) {
            return;
        }

        /* Parse it */
        void *returnedUser = httpParser.consumePostPadded((char *) data, size, user, reserved, [reserved](void *s, uWS::HttpRequest *httpRequest) -> void * {

            readBytes(httpRequest->getHeader(httpRequest->getUrl()));
            readBytes(httpRequest->getMethod());
            readBytes(httpRequest->getQuery());
            readBytes(httpRequest->getQuery("hello"));
            readBytes(httpRequest->getQuery(""));
            //readBytes(httpRequest->getParameter(0));

#ifdef UWS_WITH_PROXY
            auto *pp = (uWS::ProxyParser *) reserved;
            readBytes(pp->getSourceAddress());
#endif

            /* Route the method and URL in two passes */
            staticData.router.getUserData() = {};
            if (!staticData.router.route(httpRequest->getMethod(), httpRequest->getUrl())) {
                /* It was not handled */
                return nullptr;
            }

            for (auto p : *httpRequest) {

            }

            /* Return ok */
            return s;

        }, [](void *user, std::string_view data, bool fin) -> void * {

            /* Return ok */
            return user;

        }, [](void *user) -> void * {

            /* Return break */
            return nullptr;
        });

        if (!returnedUser) {
            /* It is of uttermost importance that if and when we return nullptr from the httpParser we must not
             * ever use the httpParser ever again. It is in a broken state as returning nullptr is only used
             * for signalling early closure. You must absolutely must throw it away. Here we just mark user as
             * null so that we can ignore further chunks of data */
            user = nullptr;
        }
    });

    return 0;
}

