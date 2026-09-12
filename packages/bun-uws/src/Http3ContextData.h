#ifndef UWS_H3CONTEXTDATA_H
#define UWS_H3CONTEXTDATA_H

#include "HttpRouter.h"

namespace uWS {

struct Http3Response;
struct Http3Request;

struct Http3ContextData {
    struct RouterData {
        Http3Response *httpResponse;
        Http3Request *httpRequest;
    };
    HttpRouter<RouterData> router;
    /* Gate for the auto 100-continue; mirrors HttpContextData. UINT64_MAX =
     * unlimited; 0 is a real limit. */
    uint64_t maxRequestBodySize = UINT64_MAX;
};

}

#endif
