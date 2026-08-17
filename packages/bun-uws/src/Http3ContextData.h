#ifndef UWS_H3CONTEXTDATA_H
#define UWS_H3CONTEXTDATA_H

#include "HttpRouter.h"
#include "MoveOnlyFunction.h"

#include <vector>

struct us_quic_socket_s;

namespace uWS {

struct Http3Response;
struct Http3Request;

struct Http3ContextData {
    struct RouterData {
        Http3Response *httpResponse;
        Http3Request *httpRequest;
    };
    HttpRouter<RouterData> router;
    /* Connection open/close hooks, as HttpContextData::filterHandlers: +2 when a QUIC connection is
     * accepted, -2 when it closes (the same "accepted" edges the HTTP/1 app reports). */
    std::vector<MoveOnlyFunction<void(struct us_quic_socket_s *, int)>> filterHandlers;
};

}

#endif
