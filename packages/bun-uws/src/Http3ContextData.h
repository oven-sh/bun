#ifndef UWS_H3CONTEXTDATA_H
#define UWS_H3CONTEXTDATA_H

#include "HttpRouter.h"
#include "StreamWebSocketTopics.h"

#include <memory>
#include <unordered_set>

namespace uWS {

struct Http3Response;
struct Http3Request;

struct Http3ContextData {
    struct RouterData {
        Http3Response *httpResponse;
        Http3Request *httpRequest;
    };
    HttpRouter<RouterData> router;

    /* RFC 9220 WebSockets on this context: their own Pub/Sub tree, and the
     * streams whose idle/close deadline the timeout sweep checks. */
    StreamTopicTree *topicTree = nullptr;
    std::unordered_set<Http3Response *> websocketStreams;
    /* Cleared when the context starts to be freed: the WebSocket transport
     * stops writing, and a sweep holding a copy stops early. */
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
};

}

#endif
