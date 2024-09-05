/*
 * Authored by Alex Hultman, 2018-2021.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef UWS_TOPICTREE_H
#define UWS_TOPICTREE_H

#include <map>
#include <list>
#include <iostream>
#include <unordered_set>
#include <utility>
#include <memory>
#include <unordered_map>
#include <vector>
#include <string_view>
#include <functional>
#include <set>
#include <string>

namespace uWS {

struct Subscriber;

struct Topic : std::unordered_set<Subscriber *> {

    Topic(std::string_view topic) : name(topic) {

    }

    std::string name;
};

struct Subscriber {

    template <typename, typename> friend struct TopicTree;

private:
    /* We use a factory */
    Subscriber() = default;

    /* State of prev, next does not matter unless we are needsDrainage() since we are not in the list */
    Subscriber *prev, *next;

    /* Any one subscriber can be part of at most 32 publishes before it needs a drain,
     * or whatever encoding of runs or whatever we might do in the future */
    uint16_t messageIndices[32];

    /* This one matters the most, if it is 0 we are not in the list of drainableSubscribers */
    unsigned char numMessageIndices = 0;

public:

    /* We have a list of topics we subscribe to (read by WebSocket::iterateTopics) */
    std::set<Topic *> topics;

    /* User data */
    void *user;

    bool needsDrainage() {
        return numMessageIndices;
    }
};

template <typename T, typename B>
struct TopicTree {

    enum IteratorFlags {
        // To appease clang-analyzer
        NONE = 0,

        LAST = 1,
        FIRST = 2,

        // To appease clang-analyzer
        FIRST_AND_LAST = FIRST | LAST
    };

    /* Whomever is iterating this topic is locked to not modify its own list */
    Subscriber *iteratingSubscriber = nullptr;

private:

    /* The drain callback must not publish, unsubscribe or subscribe.
     * It must only cork, uncork, send, write */
    std::function<bool(Subscriber *, T &, IteratorFlags)> cb;

    /* The topics */
    std::unordered_map<std::string_view, std::unique_ptr<Topic>> topics;

    /* List of subscribers that needs drainage */
    Subscriber *drainableSubscribers = nullptr;

    /* Palette of outgoing messages, up to 64k */
    std::vector<T> outgoingMessages;

    void checkIteratingSubscriber(Subscriber *s) {
        /* Notify user that they are doing something wrong here */
        if (iteratingSubscriber == s) {
            std::cerr << "Error: WebSocket must not subscribe or unsubscribe to topics while iterating its topics!" << std::endl;
            std::terminate();
        }
    }

    /* Warning: does NOT unlink from drainableSubscribers or modify next, prev. */
    void drainImpl(Subscriber *s) {
        /* Before we call cb we need to make sure this subscriber will not report needsDrainage()
         * since WebSocket::send will call drain from within the cb in that case.*/
        int numMessageIndices = s->numMessageIndices;
        s->numMessageIndices = 0;

        /* Then we emit cb */
        for (int i = 0; i < numMessageIndices; i++) {
            T &outgoingMessage = outgoingMessages[s->messageIndices[i]];

            int flags = (i == numMessageIndices - 1) ? LAST : NONE;

            /* Returning true will stop drainage short (such as when backpressure is too high) */
            if (cb(s, outgoingMessage, (IteratorFlags)(flags | (i == 0 ? FIRST : NONE)))) {
                break;
            }
        }
    }

    void unlinkDrainableSubscriber(Subscriber *s) {
        if (s->prev) {
            s->prev->next = s->next;
        }
        if (s->next) {
            s->next->prev = s->prev;
        }
        /* If we are the head, then we also need to reset the head */
        if (drainableSubscribers == s) {
            drainableSubscribers = s->next;
        }
    }

public:

    TopicTree(std::function<bool(Subscriber *, T &, IteratorFlags)> cb) : cb(cb) {

    }

    /* Returns nullptr if not found */
    Topic *lookupTopic(std::string_view topic) {
        auto it = topics.find(topic);
        if (it == topics.end()) {
            return nullptr;
        }
        return it->second.get();
    }

    /* Subscribe fails if we already are subscribed */
    Topic *subscribe(Subscriber *s, std::string_view topic) {
        /* Notify user that they are doing something wrong here */
        checkIteratingSubscriber(s);

        /* Lookup or create new topic */
        Topic *topicPtr = lookupTopic(topic);
        if (!topicPtr) {
            Topic *newTopic = new Topic(topic);
            topics.insert({std::string_view(newTopic->name.data(), newTopic->name.length()), std::unique_ptr<Topic>(newTopic)});
            topicPtr = newTopic;
        }

        /* Insert us in topic, insert topic in us */
        auto [it, inserted] = s->topics.insert(topicPtr);
        if (!inserted) {
            return nullptr;
        }
        topicPtr->insert(s);

        /* Success */
        return topicPtr;
    }

    /* Returns ok, last, newCount */
    std::tuple<bool, bool, int> unsubscribe(Subscriber *s, std::string_view topic) {
        /* Notify user that they are doing something wrong here */
        checkIteratingSubscriber(s);

        /* Lookup topic */
        Topic *topicPtr = lookupTopic(topic);
        if (!topicPtr) {
            /* If the topic doesn't exist we are assumed to still be subscribers of something */
            return {false, false, -1};
        }

        /* Erase from our list first */
        if (s->topics.erase(topicPtr) == 0) {
            return {false, false, -1};
        }

        /* Remove us from topic */
        topicPtr->erase(s);

        int newCount = topicPtr->size();

        /* If there is no subscriber to this topic, remove it */
        if (!topicPtr->size()) {
            /* Unique_ptr deletes the topic */
            topics.erase(topic);
        }

        /* If we don't hold any topics we are to be freed altogether */
        return {true, s->topics.size() == 0, newCount};
    }

    /* Factory function for creating a Subscriber */
    Subscriber *createSubscriber() {
        return new Subscriber();
    }

    /* This is used to end a Subscriber, before freeing it */
    void freeSubscriber(Subscriber *s) {

        /* I guess we call this one even if we are not subscribers */
        if (!s) {
            return;
        }

        /* For all topics, unsubscribe */
        for (Topic *topicPtr : s->topics) {
            /* If we are the last subscriber, simply remove the whole topic */
            if (topicPtr->size() == 1) {
                topics.erase(topicPtr->name);
            } else {
                /* Otherwise just remove us */
                topicPtr->erase(s);
            }
        }

        /* We also need to unlink us */
        if (s->needsDrainage()) {
            unlinkDrainableSubscriber(s);
        }

        delete s;
    }

    /* Mainly used by WebSocket::send to drain one socket before sending */
    void drain(Subscriber *s) {
        /* The list is undefined and cannot be touched unless needsDrainage(). */
        if (s->needsDrainage()) {
            /* This function differs from drainImpl by properly unlinking
            * the subscriber from drainableSubscribers. drainImpl does not. */
            unlinkDrainableSubscriber(s);

            /* This one always resets needsDrainage before it calls any cb's.
             * Otherwise we would stackoverflow when sending after publish but before drain. */
            drainImpl(s);
            
            /* If we drained last subscriber, also clear outgoingMessages */
            if (!drainableSubscribers) {
                outgoingMessages.clear();
            }
        }
    }

    /* Called everytime we call send, to drain published messages so to sync outgoing messages */
    void drain() {
        if (drainableSubscribers) {
            /* Drain one socket a time */
            for (Subscriber *s = drainableSubscribers; s; s = s->next) {
                /* Instead of unlinking every single subscriber, we just leave the list undefined
                 * and reset drainableSubscribers ptr below. */
                drainImpl(s);
            }
            /* Drain always clears drainableSubscribers and outgoingMessages */
            drainableSubscribers = nullptr;
            outgoingMessages.clear();
        }
    }

    /* Big messages bypass all buffering and land directly in backpressure */
    template <typename F>
    bool publishBig(Subscriber *sender, std::string_view topic, B &&bigMessage, F cb) {
        /* Do we even have this topic? */
        auto it = topics.find(topic);
        if (it == topics.end()) {
            return false;
        }

        /* For all subscribers in topic */
        for (Subscriber *s : *it->second) {

            /* If we are sender then ignore us */
            if (sender != s) {
                cb(s, bigMessage);
            }
        }

        return true;
    }

    /* Linear in number of affected subscribers */
    bool publish(Subscriber *sender, std::string_view topic, T &&message) {
        /* Do we even have this topic? */
        auto it = topics.find(topic);
        if (it == topics.end()) {
            return false;
        }

        /* If we have more than 65k messages we need to drain every socket. */
        if (outgoingMessages.size() == UINT16_MAX) {
            /* If there is a socket that is currently corked, this will be ugly as all sockets will drain
             * to their own backpressure */
            drain();
        }

        /* If nobody references this message, don't buffer it */
        bool referencedMessage = false;

        /* For all subscribers in topic */
        for (Subscriber *s : *it->second) {

            /* If we are sender then ignore us */
            if (sender != s) {

                /* At least one subscriber wants this message */
                referencedMessage = true;

                /* If we already have too many outgoing messages on this subscriber, drain it now */
                if (s->numMessageIndices == 32) {
                    /* This one does not need to check needsDrainage here but still does. */
                    drain(s);
                }

                /* Finally we can continue */
                s->messageIndices[s->numMessageIndices++] = (uint16_t)outgoingMessages.size();
                /* First message adds subscriber to list of drainable subscribers */
                if (s->numMessageIndices == 1) {
                    /* Insert us in the head of drainable subscribers */
                    s->next = drainableSubscribers;
                    s->prev = nullptr;
                    if (s->next) {
                        s->next->prev = s;
                    }
                    drainableSubscribers = s;
                }
            }
        }

        /* Push this message and return with success */
        if (referencedMessage) {
            outgoingMessages.emplace_back(message);
        }

        /* Success if someone wants it */
        return referencedMessage;
    }
};

}

#endif
