#define WIN32_EXPORT

#include "helpers.h"

/* Test for the topic tree */
#include "../src/TopicTree.h"

#include <memory>

// std::vector<std::string_view> topics = {"", "one", "two", "three"};

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    /* Create topic tree */
    uWS::TopicTree<std::string, std::string_view> topicTree([](uWS::Subscriber *s, std::string &message, auto flags) {

        /* Depending on what publishing we do below (with or without empty strings),
         * this assumption can hold true or not. For now it should hold true */
        if (!message.length()) {
            free((void *) -1);
        }

        /* Break if we have no subscriptions (not really an error, just to bring more randomness) */
        if (s->topics.size() == 0) {
            return true;
        }

        /* Success */
        return false;
    });

    /* Holder for all manually allocated subscribers */
    std::map<uint32_t, uWS::Subscriber *> subscribers;

    /* Iterate the padded fuzz as chunks */
    makeChunked(makePadded(data, size), size, [&topicTree, &subscribers](const uint8_t *data, size_t size) {
        /* We need at least 5 bytes */
        if (size > 4) {
            /* Last of all is a string */
            std::string_view lastString((char *) data + 5, size - 5);
            
            /* Why not */
            topicTree.lookupTopic(lastString);

            /* First 4 bytes is the subscriber id */
            uint32_t id;
            memcpy(&id, data, 4);

            /* Then one byte action */
            if (data[4] == 'S') {

                /* Some ridiculously long topics has to be cut short (OOM) */
                if (lastString.length() > 512) {
                    lastString = "too long!";
                }

                /* Subscribe */
                if (subscribers.find(id) == subscribers.end()) {

                    /* Limit number of subscribers to 100 (OOM) */
                    if (subscribers.size() > 100) {
                        return;
                    }

                    uWS::Subscriber *subscriber = topicTree.createSubscriber();
                    subscribers[id] = subscriber;
                    topicTree.subscribe(subscriber, lastString);
                } else {
                    /* Limit per subscriber subscriptions (OOM) */
                    uWS::Subscriber *subscriber = subscribers[id];
                    if (subscriber->topics.size() < 50) {
                        topicTree.subscribe(subscriber, lastString);
                    }
                }
            } else if (data[4] == 'U') {
                /* Unsubscribe */
                auto it = subscribers.find(id);
                if (it != subscribers.end()) {
                    topicTree.unsubscribe(it->second, lastString);
                }
            } else if (data[4] == 'F') {
                /* Free subscriber */
                auto it = subscribers.find(id);
                if (it != subscribers.end()) {
                    topicTree.freeSubscriber(it->second);
                    subscribers.erase(it);
                }
            } else if (data[4] == 'A') {
                /* Unsubscribe from all */
                auto it = subscribers.find(id);
                if (it != subscribers.end()) {
                    std::vector<std::string> topics;
                    for (auto *topic : it->second->topics) {
                        topics.push_back(topic->name);
                    }

                    for (std::string &topic : topics) {
                        topicTree.unsubscribe(it->second, topic);
                    }
                }
            } else if (data[4] == 'O') {
                /* Drain one socket */
                auto it = subscribers.find(id);
                if (it != subscribers.end()) {
                    topicTree.drain(it->second);
                }
            } else if (data[4] == 'P') {
                /* Publish only if we actually have data */
                if (lastString.length()) {
                    topicTree.publish(nullptr, lastString, std::string(lastString));
                } else {
                    /* We could use having more strings */
                    topicTree.publish(nullptr, "", "anything");
                }
            } else {
                /* Drain for everything else (OOM) */
                topicTree.drain();
            }
        }
    });

    /* Remove any subscriber from the tree */
    for (auto &p : subscribers) {
        topicTree.freeSubscriber(p.second);
    }

    return 0;
}

