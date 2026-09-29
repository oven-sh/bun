#ifndef UWS_STREAMWEBSOCKETTOPICS_H
#define UWS_STREAMWEBSOCKETTOPICS_H

/* Pub/Sub for WebSockets carried on multiplexed request streams (RFC 8441,
 * RFC 9220). H1 keeps its existing TopicTree callback (and therefore its hot
 * path) unchanged; each stream transport owns a separate tree whose
 * subscribers call back into the stream adapter through this type-erased
 * record, without knowing about the Rust WebSocket wrapper. */

#include "LoopData.h"
#include "TopicTree.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace uWS {

/* Returned by StreamTopicSubscriber::buffered once the stream is gone. */
constexpr size_t STREAM_TOPIC_SUBSCRIBER_GONE = SIZE_MAX;

struct StreamTopicSubscriber {
    void *user = nullptr;
    uint32_t (*send)(void *, const char *, size_t, int, bool, bool *) = nullptr;
    size_t (*buffered)(void *) = nullptr;
    size_t maxBackpressure = 0;
    void (*close)(void *) = nullptr;
};

using StreamTopicTree = TopicTree<TopicTreeMessage, TopicTreeBigMessage>;

inline StreamTopicTree *createStreamTopicTree() {
    return new StreamTopicTree([](Subscriber *s, TopicTreeMessage &message, auto) {
        auto *adapter = static_cast<StreamTopicSubscriber *>(s ? s->user : nullptr);
        if (!adapter || !adapter->send) return true;
        bool limitExceeded = false;
        uint32_t status = adapter->send(adapter->user, message.message.data(), message.message.size(), message.opCode, message.compress, &limitExceeded);
        if (limitExceeded && adapter->close) adapter->close(adapter->user);
        return status == 2;
    });
}

/* Returns the aggregate uWS send status (0 backpressure, 1 success, 2 dropped)
 * and sets `queued` when a small message was queued for a later drain. */
inline uint32_t publishToStreamTopic(StreamTopicTree *tree, Subscriber *sender, std::string_view topic,
                                     std::string_view message, int opCode, bool compress, bool &queued) {
    queued = false;
    if (!tree) return 2;
    if (message.size() >= LoopData::CORK_BUFFER_SIZE) {
        bool hasReceivers = false;
        uint32_t worst = 1;
        tree->publishBig(sender, topic, {message, opCode, compress}, [&](Subscriber *s, TopicTreeBigMessage &item) {
            hasReceivers = true;
            auto *adapter = static_cast<StreamTopicSubscriber *>(s->user);
            bool limitExceeded = false;
            uint32_t status = adapter && adapter->send ? adapter->send(adapter->user, item.message.data(), item.message.size(), item.opCode, item.compress, &limitExceeded) : 2;
            if (limitExceeded && adapter && adapter->close) adapter->close(adapter->user);
            if (status == 2 || (status == 0 && worst == 1)) worst = status;
        });
        return hasReceivers ? worst : 2;
    }
    Topic *topicPtr = tree->lookupTopic(topic);
    if (!topicPtr) return 2;
    queued = tree->publish(sender, *topicPtr, {std::string(message), opCode, compress});
    bool hasReceivers = false;
    uint32_t worst = 1;
    for (Subscriber *s : *topicPtr) {
        if (s == sender) continue;
        hasReceivers = true;
        auto *adapter = static_cast<StreamTopicSubscriber *>(s->user);
        if (!adapter || !adapter->buffered) {
            worst = 2;
            continue;
        }
        size_t buffered = adapter->buffered(adapter->user);
        if (buffered == STREAM_TOPIC_SUBSCRIBER_GONE || (adapter->maxBackpressure && buffered > adapter->maxBackpressure)) worst = 2;
        else if (buffered && worst == 1) worst = 0;
    }
    return hasReceivers ? worst : 2;
}

inline unsigned int streamTopicSubscriberCount(StreamTopicTree *tree, std::string_view topic) {
    if (!tree) return 0;
    Topic *topicPtr = tree->lookupTopic(topic);
    return topicPtr ? (unsigned int) topicPtr->size() : 0;
}

}

#endif
