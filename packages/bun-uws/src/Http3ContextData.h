#include "HttpRouter.h"

struct Http3Response;
struct Http3Request;

namespace uWS {

    struct Http3ContextData {
        struct RouterData {
            Http3Response *res;
            Http3Request *req;
        };

        HttpRouter<RouterData> router;

        Http3ContextData() {
            //printf("Constructing http3contextdata: %p\n", this);
        }
    };

}