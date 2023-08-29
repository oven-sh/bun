/*
 * Authored by Alex Hultman, 2018-2020.
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

#ifndef UWS_HTTPROUTER_HPP
#define UWS_HTTPROUTER_HPP

#include <map>
#include <vector>
#include <cstring>
#include <string_view>
#include <string>
#include <algorithm>
#include <memory>
#include <utility>

#include <iostream>

#include "MoveOnlyFunction.h"

namespace uWS {

template <class USERDATA>
struct HttpRouter {
    /* These are public for now */
    std::vector<std::string> upperCasedMethods = {
        "ACL",
        "BIND",
        "CHECKOUT",
        "CONNECT",
        "COPY",
        "DELETE",
        "GET",
        "HEAD",
        "LINK",
        "LOCK",
        "M-SEARCH" ,
        "MERGE",
        "MKACTIVITY",
        "MKCALENDAR",
        "MKCOL",
        "MOVE",
        "NOTIFY",
        "OPTIONS",
        "PATCH",
        "POST",
        "PROPFIND",
        "PROPPATCH",
        "PURGE",
        "PUT",
        "REBIND",
        "REPORT",
        "SEARCH",
        "SOURCE",
        "SUBSCRIBE",
        "TRACE",
        "UNBIND",
        "UNLINK",
        "UNLOCK",
        "UNSUBSCRIBE",
    };
    static const uint32_t HIGH_PRIORITY = 0xd0000000, MEDIUM_PRIORITY = 0xe0000000, LOW_PRIORITY = 0xf0000000;

private:
    USERDATA userData;
    static const unsigned int MAX_URL_SEGMENTS = 100;

    /* Handler ids are 32-bit */
    static const uint32_t HANDLER_MASK = 0x0fffffff;

    /* Methods and their respective priority */
    std::map<std::string, int> priority;

    /* List of handlers */
    std::vector<MoveOnlyFunction<bool(HttpRouter *)>> handlers;

    /* Current URL cache */
    std::string_view currentUrl;
    std::string_view urlSegmentVector[MAX_URL_SEGMENTS];
    int urlSegmentTop;

    /* The matching tree */
    struct Node {
        std::string name;
        std::vector<std::unique_ptr<Node>> children;
        std::vector<uint32_t> handlers;
        bool isHighPriority;

        Node(std::string name) : name(name) {}
    } root = {"rootNode"};

    /* Sort wildcards after alphanum */
    int lexicalOrder(std::string &name) {
        if (!name.length()) {
            return 2;
        }
        if (name[0] == ':') {
            return 1;
        }
        if (name[0] == '*') {
            return 0;
        }
        return 2;
    }

    /* Advance from parent to child, adding child if necessary */
    Node *getNode(Node *parent, std::string child, bool isHighPriority) {
        for (std::unique_ptr<Node> &node : parent->children) {
            if (node->name == child && node->isHighPriority == isHighPriority) {
                return node.get();
            }
        }

        /* Insert sorted, but keep order if parent is root (we sort methods by priority elsewhere) */
        std::unique_ptr<Node> newNode(new Node(child));
        newNode->isHighPriority = isHighPriority;
        return parent->children.emplace(std::upper_bound(parent->children.begin(), parent->children.end(), newNode, [parent, this](auto &a, auto &b) {

            if (a->isHighPriority != b->isHighPriority) {
                return a->isHighPriority;
            }

            return b->name.length() && (parent != &root) && (lexicalOrder(b->name) < lexicalOrder(a->name));
        }), std::move(newNode))->get();
    }

    /* Basically a pre-allocated stack */
    struct RouteParameters {
        friend struct HttpRouter;
    private:
        std::string_view params[MAX_URL_SEGMENTS];
        int paramsTop;

        void reset() {
            paramsTop = -1;
        }

        void push(std::string_view param) {
            /* We check these bounds indirectly via the urlSegments limit */
            params[++paramsTop] = param;
        }

        void pop() {
            /* Same here, we cannot pop outside */
            paramsTop--;
        }
    } routeParameters;

    /* Set URL for router. Will reset any URL cache */
    inline void setUrl(std::string_view url) {

        /* Todo: URL may also start with "http://domain/" or "*", not only "/" */

        /* We expect to stand on a slash */
        currentUrl = url;
        urlSegmentTop = -1;
    }

    /* Lazily parse or read from cache */
    inline std::pair<std::string_view, bool> getUrlSegment(int urlSegment) {
        if (urlSegment > urlSegmentTop) {
            /* Signal as STOP when we have no more URL or stack space */
            if (!currentUrl.length() || urlSegment > 99) {
                return {{}, true};
            }

            /* We always stand on a slash here, so step over it */
            currentUrl.remove_prefix(1);

            auto segmentLength = currentUrl.find('/');
            if (segmentLength == std::string::npos) {
                segmentLength = currentUrl.length();

                /* Push to url segment vector */
                urlSegmentVector[urlSegment] = currentUrl.substr(0, segmentLength);
                urlSegmentTop++;

                /* Update currentUrl */
                currentUrl = currentUrl.substr(segmentLength);
            } else {
                /* Push to url segment vector */
                urlSegmentVector[urlSegment] = currentUrl.substr(0, segmentLength);
                urlSegmentTop++;

                /* Update currentUrl */
                currentUrl = currentUrl.substr(segmentLength);
            }
        }
        /* In any case we return it */
        return {urlSegmentVector[urlSegment], false};
    }

    /* Executes as many handlers it can */
    bool executeHandlers(Node *parent, int urlSegment, USERDATA &userData) {

        auto [segment, isStop] = getUrlSegment(urlSegment);

        /* If we are on STOP, return where we may stand */
        if (isStop) {
            /* We have reached accross the entire URL with no stoppage, execute */
            for (uint32_t handler : parent->handlers) {
                if (handlers[handler & HANDLER_MASK](this)) {
                    return true;
                }
            }
            /* We reached the end, so go back */
            return false;
        }

        for (auto &p : parent->children) {
            if (p->name.length() && p->name[0] == '*') {
                /* Wildcard match (can be seen as a shortcut) */
                for (uint32_t handler : p->handlers) {
                    if (handlers[handler & HANDLER_MASK](this)) {
                        return true;
                    }
                }
            } else if (p->name.length() && p->name[0] == ':' && segment.length()) {
                /* Parameter match */
                routeParameters.push(segment);
                if (executeHandlers(p.get(), urlSegment + 1, userData)) {
                    return true;
                }
                routeParameters.pop();
            } else if (p->name == segment) {
                /* Static match */
                if (executeHandlers(p.get(), urlSegment + 1, userData)) {
                    return true;
                }
            }
        }
        return false;
    }

    /* Scans for one matching handler, returning the handler and its priority or UINT32_MAX for not found */
    uint32_t findHandler(std::string method, std::string pattern, uint32_t priority) {
        for (std::unique_ptr<Node> &node : root.children) {
            if (method == node->name) {
                setUrl(pattern);
                Node *n = node.get();
                for (int i = 0; !getUrlSegment(i).second; i++) {
                    /* Go to next segment or quit */
                    std::string segment = std::string(getUrlSegment(i).first);
                    Node *next = nullptr;
                    for (std::unique_ptr<Node> &child : n->children) {
                        if (child->name == segment && child->isHighPriority == (priority == HIGH_PRIORITY)) {
                            next = child.get();
                            break;
                        }
                    }
                    if (!next) {
                        return UINT32_MAX;
                    }
                    n = next;
                }
                /* Seek for a priority match in the found node */
                for (unsigned int i = 0; i < n->handlers.size(); i++) {
                    if ((n->handlers[i] & ~HANDLER_MASK) == priority) {
                        return n->handlers[i];
                    }
                }
                return UINT32_MAX;
            }
        }
        return UINT32_MAX;
    }

public:
    HttpRouter() {
        int p = 0;
        for (std::string &method : upperCasedMethods) {
            priority[method] = p++;
        }
    }

    std::pair<int, std::string_view *> getParameters() {
        return {routeParameters.paramsTop, routeParameters.params};
    }

    USERDATA &getUserData() {
        return userData;
    }

    /* Fast path */
    bool route(std::string_view method, std::string_view url) {
        /* Reset url parsing cache */
        setUrl(url);
        routeParameters.reset();

        /* Begin by finding the method node */
        for (auto &p : root.children) {
            if (p->name == method) {
                /* Then route the url */
                return executeHandlers(p.get(), 0, userData);
            }
        }

        /* We did not find any handler for this method and url */
        return false;
    }

    /* Adds the corresponding entires in matching tree and handler list */
    void add(std::vector<std::string> methods, std::string pattern, MoveOnlyFunction<bool(HttpRouter *)> &&handler, uint32_t priority = MEDIUM_PRIORITY) {
        for (std::string method : methods) {
            /* Lookup method */
            Node *node = getNode(&root, method, false);
            /* Iterate over all segments */
            setUrl(pattern);
            for (int i = 0; !getUrlSegment(i).second; i++) {
                node = getNode(node, std::string(getUrlSegment(i).first), priority == HIGH_PRIORITY);
            }
            /* Insert handler in order sorted by priority (most significant 1 byte) */
            node->handlers.insert(std::upper_bound(node->handlers.begin(), node->handlers.end(), (uint32_t) (priority | handlers.size())), (uint32_t) (priority | handlers.size()));
        }

        /* Alloate this handler */
        handlers.emplace_back(std::move(handler));

        /* Assume can find this handler again */
        if (((handlers.size() - 1) | priority) != findHandler(methods[0], pattern, priority)) {
            std::cerr << "Error: Internal routing error" << std::endl;
            std::abort();
        }
    }

    bool cullNode(Node *parent, Node *node, uint32_t handler) {
        /* For all children */
        for (unsigned int i = 0; i < node->children.size(); ) {
            /* Optimization todo: only enter those with same isHighPrioirty */
            /* Enter child so we get depth first */
            if (!cullNode(node, node->children[i].get(), handler)) {
                /* Only increase if this node was not removed */
                i++;
            }
        }

        /* Cull this node (but skip the root node) */
        if (parent /*&& parent != &root*/) {
            /* Scan for equal (remove), greater (lower by 1) */
            for (auto it = node->handlers.begin(); it != node->handlers.end(); ) {
                if ((*it & HANDLER_MASK) > (handler & HANDLER_MASK)) {
                    *it = ((*it & HANDLER_MASK) - 1) | (*it & ~HANDLER_MASK);
                } else if (*it == handler) {
                    it = node->handlers.erase(it);
                    continue;
                }
                it++;
            }

            /* If we have no children and no handlers, remove us from the parent->children list */
            if (!node->handlers.size() && !node->children.size()) {
                parent->children.erase(std::find_if(parent->children.begin(), parent->children.end(), [node](const std::unique_ptr<Node> &a) {
                    return a.get() == node;
                }));
                /* Returning true means we removed node from parent */
                return true;
            }
        }

        return false;
    }

    /* Removes ALL routes with the same handler as can be found with the given parameters.
     * Removing a wildcard is done by removing ONE OF the methods the wildcard would match with.
     * Example: If wildcard includes POST, GET, PUT, you can remove ALL THREE by removing GET. */
    void remove(std::string method, std::string pattern, uint32_t priority) {
        uint32_t handler = findHandler(method, pattern, priority);
        if (handler == UINT32_MAX) {
            /* Not found or already removed, do nothing */
            return;
        }

        /* Cull the entire tree */
        /* For all nodes in depth first tree traveral;
         * if node contains handler - remove the handler -
         * if node holds no handlers after removal, remove the node and return */
        cullNode(nullptr, &root, handler);

        /* Now remove the actual handler */
        handlers.erase(handlers.begin() + (handler & HANDLER_MASK));
    }
};

}

#endif // UWS_HTTPROUTER_HPP
