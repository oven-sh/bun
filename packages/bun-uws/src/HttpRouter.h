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
#include <unordered_map>
#include <vector>
#include <cstring>
#include <string_view>
#include <string>
#include <functional>
#include <algorithm>
#include <memory>
#include <utility>
#include <span>
#include <iostream>

#include "MoveOnlyFunction.h"

namespace uWS {

template <typename UserDataType>
struct HttpRouter {
    static constexpr std::string_view ANY_METHOD_TOKEN = "*";
    static constexpr uint32_t HIGH_PRIORITY = 0xd0000000, MEDIUM_PRIORITY = 0xe0000000, LOW_PRIORITY = 0xf0000000;

private:
    UserDataType userData;
    static constexpr unsigned int MAX_URL_SEGMENTS = 100;

    /* Handler ids are 32-bit */
    static constexpr uint32_t HANDLER_MASK = 0x0fffffff;

    /* List of handlers */
    std::vector<MoveOnlyFunction<bool(HttpRouter *)>> handlers;

    /* Current URL cache */
    std::string_view currentUrl = {};
    std::string_view urlSegmentVector[MAX_URL_SEGMENTS] = {};
    int urlSegmentTop = -1;

    /* Transparent hash so find() accepts std::string_view without allocating */
    struct StringViewHash {
        using is_transparent = void;
        size_t operator()(std::string_view s) const noexcept { return std::hash<std::string_view>{}(s); }
        size_t operator()(const std::string &s) const noexcept { return std::hash<std::string_view>{}(s); }
    };

    /* The matching tree.
     *
     * Children are split by name class so that both registration and routing are
     * O(1) per segment instead of the previous linear scan over a single vector
     * (Bun.serve expands an "any" route to ~36 methods, so a flat N-route table
     * used to cost ~36*N^2 string compares to build):
     *   - staticChildren: literal segment names, hashed. At most one can match a
     *     given URL segment so iteration is never needed.
     *   - specialChildren: ':' param and '*' wildcard segments, kept ordered
     *     (':' before '*') and tried after the static match at the same priority.
     * Each is further split by priority tier: [1] = HIGH_PRIORITY (upgrade
     * routes), [0] = everything else. Matching tries [1] before [0].
     *
     * The child containers live behind a lazily-allocated Children block so a
     * leaf Node (the vast majority: one per route per method) carries only a
     * null pointer instead of two empty hash maps and two empty vectors.
     */
    struct Node {
        using ChildMap = std::unordered_map<std::string, std::unique_ptr<Node>, StringViewHash, std::equal_to<>>;

        struct Children {
            ChildMap staticChildren[2] = {};
            std::vector<std::unique_ptr<Node>> specialChildren[2] = {};
        };

        std::string name = {};
        std::vector<uint32_t> handlers = {};
        std::unique_ptr<Children> children = {};

        explicit Node(std::string name) : name(std::move(name)) {}

        Children &ensureChildren() {
            if (!children) {
                children = std::make_unique<Children>();
            }
            return *children;
        }
    } root {"rootNode"};

    /* ':' and '*' segments live in specialChildren; everything else (including
     * the empty segment from "//") is a static name. */
    static bool isSpecialName(std::string_view name) {
        return !name.empty() && (name[0] == ':' || name[0] == '*');
    }

    /* Sort wildcards after alphanum */
    int lexicalOrder(std::string_view name) {
        if (name.empty()) {
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
    Node *getNode(Node *parent, std::string_view child, bool isHighPriority) {
        auto &children = parent->ensureChildren();
        unsigned int prio = isHighPriority ? 1 : 0;
        if (!isSpecialName(child)) {
            auto &map = children.staticChildren[prio];
            if (auto it = map.find(child); it != map.end()) {
                return it->second.get();
            }
            auto newNode = std::make_unique<Node>(std::string(child));
            Node *ptr = newNode.get();
            map.emplace(ptr->name, std::move(newNode));
            return ptr;
        }

        auto &vec = children.specialChildren[prio];
        for (const std::unique_ptr<Node> &node : vec) {
            if (node->name == child) {
                return node.get();
            }
        }
        auto newNode = std::make_unique<Node>(std::string(child));
        /* Keep ':' before '*' so executeHandlers tries param before wildcard. */
        auto iter = std::upper_bound(vec.begin(), vec.end(), newNode, [this](auto &a, auto &b) {
            return lexicalOrder(b->name) < lexicalOrder(a->name);
        });
        return vec.emplace(iter, std::move(newNode))->get();
    }

    /* Basically a pre-allocated stack */
    struct RouteParameters {
        friend struct HttpRouter;
    private:
        std::string_view params[MAX_URL_SEGMENTS] = {};
        int paramsTop = -1;

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
    void setUrl(std::string_view url) {

        /* Todo: URL may also start with "http://domain/" or "*", not only "/" */

        /* We expect to stand on a slash */
        currentUrl = url;
        urlSegmentTop = -1;
    }

    /* Lazily parse or read from cache */
    std::pair<std::string_view, bool> getUrlSegment(int urlSegment) {
        if (urlSegment > urlSegmentTop) {
            /* Signal as STOP when we have no more URL or stack space */
            if (!currentUrl.length() || urlSegment > int(MAX_URL_SEGMENTS - 1)) {
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
    bool executeHandlers(Node *parent, int urlSegment, UserDataType &userData) {

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

        if (!parent->children) {
            return false;
        }
        auto &children = *parent->children;

        /* High-priority tier first, then normal. Within a tier: the (at most one)
         * static match, then ':' param, then '*' wildcard. This is the same order
         * the old sorted children vector produced. */
        for (int prio = 1; prio >= 0; prio--) {
            auto &staticMap = children.staticChildren[prio];
            if (!staticMap.empty()) {
                if (auto it = staticMap.find(segment); it != staticMap.end()) {
                    if (executeHandlers(it->second.get(), urlSegment + 1, userData)) {
                        return true;
                    }
                }
            }
            for (auto &p : children.specialChildren[prio]) {
                if (p->name.starts_with('*')) {
                    /* Wildcard match (can be seen as a shortcut) */
                    for (uint32_t handler : p->handlers) {
                        if (handlers[handler & HANDLER_MASK](this)) {
                            return true;
                        }
                    }
                } else if (p->name.starts_with(':') && !segment.empty()) {
                    /* Parameter match */
                    routeParameters.push(segment);
                    if (executeHandlers(p.get(), urlSegment + 1, userData)) {
                        return true;
                    }
                    routeParameters.pop();
                }
            }
        }
        return false;
    }

    /* Scans for one matching handler, returning the handler and its priority or UINT32_MAX for not found */
    uint32_t findHandler(std::string_view method, std::string_view pattern, uint32_t priority) {
        bool isHighPrio = (priority == HIGH_PRIORITY);
        Node *n = findMethodNode(method);
        if (!n) {
            return UINT32_MAX;
        }
        setUrl(pattern);
        for (int i = 0; !getUrlSegment(i).second; i++) {
            if (!n->children) {
                return UINT32_MAX;
            }
            auto &children = *n->children;
            std::string_view segment = getUrlSegment(i).first;
            Node *next = nullptr;
            if (isSpecialName(segment)) {
                /* ':' pattern segments match the single ':' child (names were
                 * stripped on insert); '*' matches by exact name. */
                bool segIsParam = segment[0] == ':';
                for (auto &c : children.specialChildren[isHighPrio ? 1 : 0]) {
                    if (segIsParam ? c->name.starts_with(':') : c->name == segment) {
                        next = c.get();
                        break;
                    }
                }
            } else {
                auto &map = children.staticChildren[isHighPrio ? 1 : 0];
                if (auto it = map.find(segment); it != map.end()) {
                    next = it->second.get();
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

    /* Root's children are method names; all live in the normal-priority tier. */
    Node *findMethodNode(std::string_view method) {
        if (!root.children) {
            return nullptr;
        }
        auto &children = *root.children;
        if (isSpecialName(method)) {
            for (auto &c : children.specialChildren[0]) {
                if (c->name == method) {
                    return c.get();
                }
            }
            return nullptr;
        }
        auto &map = children.staticChildren[0];
        auto it = map.find(method);
        return it != map.end() ? it->second.get() : nullptr;
    }

public:
    HttpRouter() {
        /* Always have ANY route */
        getNode(&root, ANY_METHOD_TOKEN, false);
    }

    std::pair<int, std::string_view *> getParameters() {
        return {routeParameters.paramsTop, routeParameters.params};
    }

    UserDataType &getUserData() {
        return userData;
    }

    /* Fast path */
    bool route(std::string_view method, std::string_view url) {
        /* Reset url parsing cache */
        setUrl(url);
        routeParameters.reset();

        if (!root.children) [[unlikely]] {
            return false;
        }
        auto &children = *root.children;

        /* Begin by finding the method node */
        auto it = children.staticChildren[0].find(method);
        if (it != children.staticChildren[0].end()) {
            if (executeHandlers(it->second.get(), 0, userData)) {
                return true;
            }
        }

        /* Always test any route last. ANY_METHOD_TOKEN is root's only
         * specialChildren[0] entry in practice, but look it up by name so a
         * cullNode() that removed it cannot leave a stale pointer behind. */
        for (auto &p : children.specialChildren[0]) {
            if (p->name == ANY_METHOD_TOKEN) {
                return executeHandlers(p.get(), 0, userData);
            }
        }
        return false;
    }

    /* Adds the corresponding entires in matching tree and handler list */
    void add(std::span<const std::string_view> methods, std::string_view pattern, MoveOnlyFunction<bool(HttpRouter *)> &&handler, uint32_t priority = MEDIUM_PRIORITY) {
        /* First remove existing handler */
        remove(methods[0], pattern, priority);

        for (const std::string_view method : methods) {
            /* Lookup method */
            Node *node = getNode(&root, method, false);
            /* Iterate over all segments */
            setUrl(pattern);
            for (int i = 0; !getUrlSegment(i).second; i++) {
                std::string strippedSegment(getUrlSegment(i).first);
                if (strippedSegment.length() > 1 && strippedSegment[0] == ':') {
                    /* Parameter routes must be named only : */
                    strippedSegment.resize(1);
                }
                node = getNode(node, strippedSegment, priority == HIGH_PRIORITY);
            }
            /* Insert handler in order sorted by priority (most significant 1 byte) */
            uint32_t new_priority(priority | handlers.size());
            node->handlers.insert(std::upper_bound(node->handlers.begin(), node->handlers.end(), new_priority), new_priority);
        }

        /* Alloate this handler */
        handlers.emplace_back(std::move(handler));
    }

    bool cullNode(Node *parent, Node *node, uint32_t handler) {
        /* For all children of either kind */
        if (node->children) {
            auto &children = *node->children;
            for (int prio = 0; prio < 2; prio++) {
                for (auto it = children.staticChildren[prio].begin(); it != children.staticChildren[prio].end(); ) {
                    if (cullNode(node, it->second.get(), handler)) {
                        it = children.staticChildren[prio].erase(it);
                    } else {
                        ++it;
                    }
                }
                for (unsigned int i = 0; i < children.specialChildren[prio].size(); ) {
                    if (cullNode(node, children.specialChildren[prio][i].get(), handler)) {
                        children.specialChildren[prio].erase(children.specialChildren[prio].begin() + i);
                    } else {
                        i++;
                    }
                }
            }
            if (children.staticChildren[0].empty() && children.staticChildren[1].empty()
                && children.specialChildren[0].empty() && children.specialChildren[1].empty()) {
                node->children.reset();
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

            /* Returning true signals the caller to erase us from its container */
            return node->handlers.empty() && !node->children;
        }

        return false;
    }

    /* Removes ALL routes with the same handler as can be found with the given parameters.
     * Removing a wildcard is done by removing ONE OF the methods the wildcard would match with.
     * Example: If wildcard includes POST, GET, PUT, you can remove ALL THREE by removing GET. */
    bool remove(std::string_view method, std::string_view pattern, uint32_t priority) {
        uint32_t handler = findHandler(method, pattern, priority);
        if (handler == UINT32_MAX) {
            /* Not found or already removed, do nothing */
            return false;
        }

        /* Cull the entire tree */
        /* For all nodes in depth first tree traveral;
         * if node contains handler - remove the handler -
         * if node holds no handlers after removal, remove the node and return */
        cullNode(nullptr, &root, handler);

        /* Now remove the actual handler */
        handlers.erase(handlers.begin() + (handler & HANDLER_MASK));

        return true;
    }
};

}

#endif // UWS_HTTPROUTER_HPP
