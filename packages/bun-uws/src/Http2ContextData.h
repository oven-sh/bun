#ifndef UWS_H2CONTEXTDATA_H
#define UWS_H2CONTEXTDATA_H

#include "HttpRouter.h"

namespace uWS {

struct Http2Response;
struct Http2Request;

/* Mirrors Http3ContextData so the H3 routing shape applies unchanged. */
struct Http2ContextData {
    struct RouterData {
        Http2Response *httpResponse;
        Http2Request *httpRequest;
    };
    HttpRouter<RouterData> router;
    unsigned int idleTimeoutS = 10;
};

}

#endif
