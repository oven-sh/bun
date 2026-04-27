#ifndef UWS_H3CONTEXTDATA_H
#define UWS_H3CONTEXTDATA_H

#include "HttpRouter.h"
#include "WebTransportSession.h"

namespace uWS {

struct Http3Response;
struct Http3Request;

struct Http3ContextData {
    struct RouterData {
        Http3Response *httpResponse;
        Http3Request *httpRequest;
    };
    HttpRouter<RouterData> router;

    /* Populated by H3App::wt(). The CONNECT request still goes through
     * `router` (so wt() registers a "connect" route), but the stream/
     * datagram callbacks dispatch via wt directly since they have no path. */
    WebTransportContextData wt;
};

inline WebTransportContextData *WebTransportSession::getContextData() {
    return &((Http3ContextData *) us_quic_socket_context_ext(
        us_quic_stream_context((us_quic_stream_t *) this)))->wt;
}

}

#endif
