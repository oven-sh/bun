#ifndef UWS_H3CONTEXTDATA_H
#define UWS_H3CONTEXTDATA_H

#include "HttpRouter.h"

namespace uWS {

struct Http3Response;
struct Http3Request;
struct Http3WebTransportSession;

struct Http3ContextData {
    struct RouterData {
        Http3Response *httpResponse;
        Http3Request *httpRequest;
    };
    HttpRouter<RouterData> router;

    /* WebTransport session callbacks, set once when the app declares a
     * handler. Plain function pointers rather than the router's
     * MoveOnlyFunction because the only caller is Rust, which has no closure
     * to carry and would otherwise pay an allocation per app. `open` is not
     * here: a session is opened by the CONNECT route, which already runs
     * through the router like any other request. */
    void (*onWebTransportDatagram)(Http3WebTransportSession *, const char *, unsigned) = nullptr;
    void (*onWebTransportClose)(Http3WebTransportSession *, uint32_t, const char *, size_t) = nullptr;
};

}

#endif
