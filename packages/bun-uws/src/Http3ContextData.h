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

    /* Plain function pointers rather than the router's MoveOnlyFunction: the
     * only caller is Rust, which has no closure to carry. `open` is not here —
     * the CONNECT route opens a session through the router. */
    void (*onWebTransportDatagram)(Http3WebTransportSession *, const char *, unsigned) = nullptr;
    void (*onWebTransportClose)(Http3WebTransportSession *, uint32_t, const char *, size_t) = nullptr;
    void (*onWebTransportDrain)(Http3WebTransportSession *) = nullptr;
};

}

#endif
