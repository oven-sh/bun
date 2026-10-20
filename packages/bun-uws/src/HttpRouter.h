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

#include <cstdint>
#include <map>
#include <vector>
#include <cstring>
#include <string_view>
#include <string>
#include <algorithm>
#include <memory>
#include <utility>
#include <span>

#include "MoveOnlyFunction.h"

#include <wtf/Assertions.h>
#include <wtf/HashFunctions.h>
#include <wtf/text/StringHasher.h>

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

    /* Counts loop iterations for tests. Only a user data type that has a
     * routerSteps member is counted, so a server pays nothing. */
    void step(uint64_t count = 1) {
        if constexpr (requires(UserDataType &data) { data.routerSteps += count; }) {
            userData.routerSteps += count;
        }
    }

    static constexpr uint32_t NONE = UINT32_MAX;
    static constexpr uint32_t ROOT = 0;
    /* A run of static children this short is scanned by name, as hashing the
     * segment costs more than the few compares */
    static constexpr uint32_t SCANNED_RUN = 8;
    /* The first word of an item in a child list has one of these marks. An
     * item with no mark is the ':' child. */
    static constexpr uint32_t WILDCARD = 0x80000000;
    static constexpr uint32_t STATIC = 0x40000000;
    static constexpr uint32_t STATIC_RUN = 0x20000000;

    /* The matching tree, stored flat. Nodes name their parent by index and
     * nothing points at a node, so `nodes` can grow and be compacted freely.
     *
     * add() appends nodes and finds an existing child through `lookup`, a hash
     * index over (parent, priority tier, name), so registration is O(1) per
     * segment. sortRoutes() then lays every child list out in `edges` and
     * frees `lookup`. route() reads only the laid out lists. */
    struct Node {
        /* The name is names[nameOffset, nameOffset + nameLength). One add()
         * stores a segment once and the node of every method shares it. */
        uint32_t nameOffset;
        uint32_t nameLength;
        uint32_t parent;
        /* Head of this node's handlers in handlerLinks, ordered by priority */
        uint32_t firstHandler;
        /* Offset of this node's child list in edges */
        uint32_t childList;
        /* Live children. A node with no handler and no child is dropped. */
        uint32_t children : 30;
        uint32_t isHighPriority : 1;
        uint32_t dead : 1;
    };
    static_assert(sizeof(Node) == 24);

    struct HandlerLink {
        uint32_t handler;
        uint32_t next;
    };

    std::vector<Node> nodes;
    std::vector<char> names;
    std::vector<HandlerLink> handlerLinks;
    uint32_t freeHandlerLink = NONE;
    uint32_t deadNodes = 0;
    /* The method nodes, which are the live children of the root */
    std::vector<uint32_t> methodNodes;
    /* A removed handler leaves an empty slot in handlers until the next sort,
     * so that a removal does not renumber every handler after it */
    uint32_t removedHandlers = 0;

    /* One child list per node that has children: the number of words that
     * follow, then the items in the order route() tries them. That order is
     * high priority (WebSocket upgrade) before normal, and within a priority
     * the static names, then ':', then '*'. edges[0] is the list of a leaf.
     *
     *   { STATIC | nameLength, nameOffset, child }      a static child
     *   { STATIC_RUN | children, hashes..., children... }  more than SCANNED_RUN static children
     *   { 0, child }                                    the ':' child
     *   { WILDCARD | handlers, handler... }             a '*' child, in the order added
     *
     * A run has the hashes of its names, sorted, then the children in the
     * same order, so a search stays inside one run of integers and reads a
     * name only to confirm the match. */
    std::vector<uint32_t> edges;

    /* Open addressing over node indices. Empty means not built. */
    std::vector<uint32_t> lookup;
    uint32_t lookupCount = 0;

    /* True while edges matches the nodes. Every add() and remove() clears it. */
    bool ready = false;

    /* route() does not search for the method most requests use, nor for the
     * last method, which is tried for every request no method route took */
    uint32_t commonMethodWord = NONE;
    uint32_t commonMethod = NONE;
    uint32_t lastMethod = NONE;
    /* False when ANY is the only method, as on the HTTP/2 and HTTP/3 routers
     * of a server with no method-specific route */
    bool hasMethods = false;

    std::string_view nameOf(const Node &node) const {
        return {names.data() + node.nameOffset, node.nameLength};
    }

    static uint32_t hashName(std::string_view name) {
        return StringHasher::computeHashAndMaskTop8Bits(byteCast<Latin1Character>(std::span<const char>(name.data(), name.size())));
    }

    static uint32_t hashKey(uint32_t parent, bool isHighPriority, std::string_view name) {
        return WTF::pairIntHash(hashName(name), (parent << 1) | (uint32_t) isHighPriority);
    }

    uint32_t lookupFind(uint32_t parent, std::string_view name, bool isHighPriority) {
        size_t mask = lookup.size() - 1;
        for (size_t i = hashKey(parent, isHighPriority, name) & mask;; i = (i + 1) & mask) {
            step();
            uint32_t candidate = lookup[i];
            if (candidate == NONE) {
                return NONE;
            }
            const Node &node = nodes[candidate];
            if (node.parent == parent && node.isHighPriority == isHighPriority && nameOf(node) == name) {
                return candidate;
            }
        }
    }

    void lookupInsert(uint32_t index) {
        const Node &node = nodes[index];
        size_t mask = lookup.size() - 1;
        size_t i = hashKey(node.parent, node.isHighPriority, nameOf(node)) & mask;
        while (lookup[i] != NONE) {
            step();
            i = (i + 1) & mask;
        }
        lookup[i] = index;
        lookupCount++;
    }

    /* Takes a node out of the index. The entries after it in its probe run move
     * back, so that a search still reaches them. */
    void lookupErase(uint32_t index) {
        size_t mask = lookup.size() - 1;
        const Node &node = nodes[index];
        size_t hole = hashKey(node.parent, node.isHighPriority, nameOf(node)) & mask;
        while (lookup[hole] != index) {
            step();
            ASSERT(lookup[hole] != NONE);
            hole = (hole + 1) & mask;
        }
        for (size_t next = (hole + 1) & mask; lookup[next] != NONE; next = (next + 1) & mask) {
            step();
            const Node &moved = nodes[lookup[next]];
            size_t home = hashKey(moved.parent, moved.isHighPriority, nameOf(moved)) & mask;
            if (((next - home) & mask) >= ((next - hole) & mask)) {
                lookup[hole] = lookup[next];
                hole = next;
            }
        }
        lookup[hole] = NONE;
        lookupCount--;
    }

    void rebuildLookup(size_t capacity) {
        lookup.assign(capacity, NONE);
        lookupCount = 0;
        for (uint32_t i = 1; i < nodes.size(); i++) {
            step();
            if (!nodes[i].dead) {
                lookupInsert(i);
            }
        }
    }

    void ensureLookup() {
        if (!lookup.empty()) {
            return;
        }
        size_t capacity = 16;
        while (capacity * 3 < (nodes.size() - deadNodes) * 4) {
            capacity *= 2;
        }
        rebuildLookup(capacity);
    }

    std::string_view nameAt(uint32_t offset, uint32_t length) const {
        return {names.data() + offset, length};
    }

    /* Searches a run of static children that is sorted by name hash */
    NEVER_INLINE uint32_t searchRun(const uint32_t *hashes, uint32_t count, std::string_view name) {
        ASSERT(count);
        const uint32_t *children = hashes + count;
        uint32_t hash = hashName(name);
        /* The first hash that is not below the name's, with no branch to predict */
        const uint32_t *first = hashes;
        for (uint32_t size = count; size > 1;) {
            step();
            uint32_t half = size / 2;
            first += first[half - 1] < hash ? half : 0;
            size -= half;
        }
        uint32_t low = (uint32_t) (first - hashes) + (*first < hash ? 1 : 0);
        for (; low < count && hashes[low] == hash; low++) {
            step();
            if (nameOf(nodes[children[low]]) == name) {
                return children[low];
            }
        }
        return NONE;
    }

    /* Finds an existing child by exact name */
    uint32_t findChild(uint32_t parent, std::string_view name, bool isHighPriority) {
        ensureLookup();
        return lookupFind(parent, name, isHighPriority);
    }

    /* Advance from parent to child, adding child if necessary. stored is where
     * this add() already put the name, or NONE. */
    uint32_t getNode(uint32_t parent, std::string_view child, bool isHighPriority, uint32_t &stored) {
        ensureLookup();
        uint32_t existing = lookupFind(parent, child, isHighPriority);
        if (existing != NONE) {
            return existing;
        }
        if (((size_t) lookupCount + 1) * 4 > lookup.size() * 3) {
            rebuildLookup(lookup.size() * 2);
        }
        /* A node, a name and a child list are found by a 32-bit index */
        RELEASE_ASSERT(nodes.size() < NONE && child.size() < STATIC_RUN && names.size() + child.size() < NONE);
        if (stored == NONE) {
            stored = (uint32_t) names.size();
            names.insert(names.end(), child.begin(), child.end());
        }
        uint32_t index = (uint32_t) nodes.size();
        nodes.push_back({stored, (uint32_t) child.size(), parent, NONE, 0, 0, isHighPriority, false});
        nodes[parent].children++;
        if (parent == ROOT) {
            methodNodes.push_back(index);
        }
        lookupInsert(index);
        ready = false;
        return index;
    }

    /* Drops the node if it has no handler and no child, and then its parent */
    void dropIfEmpty(uint32_t index) {
        while (index != ROOT) {
            step();
            Node &node = nodes[index];
            if (node.firstHandler != NONE || node.children) {
                return;
            }
            if (!lookup.empty()) {
                lookupErase(index);
            }
            node.dead = true;
            deadNodes++;
            uint32_t parent = node.parent;
            nodes[parent].children--;
            if (parent == ROOT) {
                auto method = std::find(methodNodes.begin(), methodNodes.end(), index);
                ASSERT(method != methodNodes.end());
                methodNodes.erase(method);
            }
            index = parent;
        }
    }

    /* Drops dead nodes. A child always has a higher index than its parent and a
     * live node has a live parent, so one forward pass renumbers everything. */
    void compact() {
        if (!deadNodes) {
            return;
        }
        std::vector<uint32_t> moved(nodes.size(), NONE);
        uint32_t live = 0;
        for (uint32_t i = 0; i < nodes.size(); i++) {
            step();
            if (nodes[i].dead) {
                continue;
            }
            moved[i] = live;
            if (i != ROOT) {
                ASSERT(moved[nodes[i].parent] != NONE);
                nodes[i].parent = moved[nodes[i].parent];
            }
            if (live != i) {
                nodes[live] = std::move(nodes[i]);
            }
            live++;
        }
        nodes.erase(nodes.begin() + live, nodes.end());
        deadNodes = 0;
        for (uint32_t &method : methodNodes) {
            method = moved[method];
        }

        /* Keep the names that a live node still uses. Nodes share names, so
         * each one moves once. An empty name takes no room: its offset can be
         * the offset of another name, or the end of names. */
        std::vector<uint32_t> movedName(names.size(), NONE);
        std::vector<char> kept;
        for (Node &node : nodes) {
            if (!node.nameLength) {
                node.nameOffset = 0;
                continue;
            }
            uint32_t &to = movedName[node.nameOffset];
            if (to == NONE) {
                to = (uint32_t) kept.size();
                kept.insert(kept.end(), names.begin() + node.nameOffset, names.begin() + node.nameOffset + node.nameLength);
            }
            node.nameOffset = to;
        }
        names = std::move(kept);
    }

    /* What a child is to the list it goes in: 0 static, 1 parameter, 2 wildcard.
     * A ':' or '*' segment matches by rule, every other name (the empty
     * segment of "//" too) matches itself. Methods always match themselves. */
    uint32_t kindOf(const Node &node) const {
        if (node.parent == ROOT || !node.nameLength) {
            return 0;
        }
        char first = names[node.nameOffset];
        return first == ':' ? 1 : first == '*' ? 2 : 0;
    }

    /* The words that the children of one priority take in a child list */
    struct ItemSizes {
        uint32_t statics[2] = {0, 0};
        uint32_t specialWords[2] = {0, 0};
        /* A name too long for a STATIC item puts the static children in a run */
        bool longName[2] = {false, false};

        bool isRun(uint32_t tier) const {
            return statics[tier] > SCANNED_RUN || longName[tier];
        }

        uint32_t words(uint32_t tier) const {
            return (isRun(tier) ? 1 + statics[tier] * 2 : statics[tier] * 3) + specialWords[tier];
        }
    };

    /* Tier 0 is high priority, tier 1 is normal */
    ItemSizes measureChildren(const uint32_t *first, const uint32_t *last) const {
        ItemSizes sizes;
        for (; first != last; first++) {
            const Node &node = nodes[*first];
            uint32_t tier = node.isHighPriority ? 0 : 1;
            switch (kindOf(node)) {
            case 0:
                sizes.statics[tier]++;
                sizes.longName[tier] |= node.nameLength >= STATIC_RUN;
                break;
            case 1:
                sizes.specialWords[tier] += 2;
                break;
            default:
                uint32_t count = 0;
                for (uint32_t link = node.firstHandler; link != NONE; link = handlerLinks[link].next) {
                    count++;
                }
                /* A '*' child with no handler matches nothing */
                sizes.specialWords[tier] += count ? 1 + count : 0;
                break;
            }
        }
        return sizes;
    }

    struct HashedChild {
        uint32_t hash;
        uint32_t child;
    };

    void writeItems(std::vector<uint32_t> &out, const uint32_t *first, const uint32_t *last, uint32_t tier, const ItemSizes &sizes, std::vector<HashedChild> &scratch) {
        auto each = [&](uint32_t kind, auto &&write) {
            for (const uint32_t *child = first; child != last; child++) {
                const Node &node = nodes[*child];
                if ((node.isHighPriority ? 0u : 1u) == tier && kindOf(node) == kind) {
                    write(*child, node);
                }
            }
        };
        if (!sizes.isRun(tier)) {
            each(0, [&](uint32_t child, const Node &node) {
                out.push_back(STATIC | node.nameLength);
                out.push_back(node.nameOffset);
                out.push_back(child);
            });
        } else {
            scratch.clear();
            each(0, [&](uint32_t child, const Node &node) {
                scratch.push_back({hashName(nameOf(node)), child});
            });
            std::sort(scratch.begin(), scratch.end(), [this](const HashedChild &a, const HashedChild &b) {
                step();
                return a.hash != b.hash ? a.hash < b.hash : a.child < b.child;
            });
            RELEASE_ASSERT(scratch.size() < STATIC_RUN);
            out.push_back(STATIC_RUN | (uint32_t) scratch.size());
            for (const HashedChild &entry : scratch) {
                out.push_back(entry.hash);
            }
            for (const HashedChild &entry : scratch) {
                out.push_back(entry.child);
            }
        }
        each(1, [&](uint32_t child, const Node &) {
            out.push_back(0);
            out.push_back(child);
        });
        each(2, [&](uint32_t, const Node &node) {
            size_t header = out.size();
            for (uint32_t link = node.firstHandler; link != NONE; link = handlerLinks[link].next) {
                if (out.size() == header) {
                    out.push_back(WILDCARD);
                }
                out[header]++;
                out.push_back(handlerLinks[link].handler & HANDLER_MASK);
            }
        });
    }

    void buildEdges() {
        /* Group the children by parent. A parent's children stay in the order
         * they were added in, which is the order of their indices. */
        std::vector<uint32_t> end(nodes.size(), 0);
        uint32_t longest = 0;
        for (uint32_t i = 1; i < nodes.size(); i++) {
            step();
            longest = std::max(longest, ++end[nodes[i].parent]);
        }
        uint32_t total = 0;
        for (uint32_t &count : end) {
            total += std::exchange(count, total);
        }
        std::vector<uint32_t> children(total);
        for (uint32_t i = 1; i < nodes.size(); i++) {
            children[end[nodes[i].parent]++] = i;
        }

        /* The first word is the list of every node that has no item */
        size_t words = 1;
        uint32_t begin = 0;
        for (uint32_t parent = 0; parent < nodes.size(); begin = end[parent++]) {
            ItemSizes sizes = measureChildren(children.data() + begin, children.data() + end[parent]);
            if (uint32_t items = sizes.words(0) + sizes.words(1)) {
                words += 1 + items;
            }
        }
        RELEASE_ASSERT(words < NONE);

        std::vector<uint32_t> lists;
        lists.reserve(words);
        lists.push_back(0);
        std::vector<HashedChild> scratch;
        scratch.reserve(longest);
        begin = 0;
        for (uint32_t parent = 0; parent < nodes.size(); begin = end[parent++]) {
            const uint32_t *first = children.data() + begin;
            const uint32_t *last = children.data() + end[parent];
            ItemSizes sizes = measureChildren(first, last);
            uint32_t items = sizes.words(0) + sizes.words(1);
            nodes[parent].childList = items ? (uint32_t) lists.size() : 0;
            if (items) {
                lists.push_back(items);
                writeItems(lists, first, last, 0, sizes, scratch);
                writeItems(lists, first, last, 1, sizes, scratch);
                ASSERT(lists.size() == nodes[parent].childList + 1 + items);
            }
        }
        ASSERT(lists.size() == words);
        edges = std::move(lists);
    }

    /* Closes the gaps that removed handlers left. The handlers keep their order,
     * which is the order handlers of one priority run in. */
    void compactHandlers() {
        if (!removedHandlers) {
            return;
        }
        std::vector<uint32_t> renumbered(handlers.size(), NONE);
        uint32_t live = 0;
        for (uint32_t i = 0; i < handlers.size(); i++) {
            step();
            if (!handlers[i]) {
                continue;
            }
            renumbered[i] = live;
            if (live != i) {
                handlers[live] = std::move(handlers[i]);
            }
            live++;
        }
        handlers.erase(handlers.begin() + live, handlers.end());
        for (const Node &node : nodes) {
            for (uint32_t link = node.dead ? NONE : node.firstHandler; link != NONE; link = handlerLinks[link].next) {
                step();
                uint32_t handler = handlerLinks[link].handler;
                ASSERT(renumbered[handler & HANDLER_MASK] != NONE);
                handlerLinks[link].handler = (handler & ~HANDLER_MASK) | renumbered[handler & HANDLER_MASK];
            }
        }
        removedHandlers = 0;
    }

    /* Gives back the capacity that growth left over. shrink_to_fit() does
     * nothing in libstdc++ when exceptions are off. */
    template <typename T>
    static void trim(std::vector<T> &items) {
        if (items.capacity() != items.size()) {
            std::vector<T>(items.begin(), items.end()).swap(items);
        }
    }

    static bool isLaterMethod(std::string_view method, std::string_view other) {
        if (method == "GET" || other == ANY_METHOD_TOKEN) {
            return false;
        }
        return other == "GET" || method == ANY_METHOD_TOKEN || method > other;
    }

    /* A three letter method as one word, 0 for every other length */
    static uint32_t methodWord(std::string_view method) {
        if (method.size() != 3) {
            return 0;
        }
        uint16_t head;
        memcpy(&head, method.data(), 2);
        return head | ((uint32_t) (unsigned char) method[2] << 16);
    }

#if ASSERT_ENABLED
    /* What route() relies on after a sort */
    void validate() const {
        ASSERT(lookup.empty() && !deadNodes && !removedHandlers && !edges[0]);
        size_t children = 0;
        for (uint32_t i = 0; i < nodes.size(); i++) {
            const Node &node = nodes[i];
            ASSERT(!node.dead && (i == ROOT || node.parent < i));
            ASSERT(node.nameLength <= names.size() && node.nameOffset <= names.size() - node.nameLength);
            ASSERT(node.childList < edges.size() && node.childList + edges[node.childList] < edges.size());
            children += node.children;
            for (uint32_t link = node.firstHandler; link != NONE; link = handlerLinks[link].next) {
                ASSERT(link < handlerLinks.size());
                uint32_t handler = handlerLinks[link].handler & HANDLER_MASK;
                ASSERT(handler < handlers.size() && handlers[handler]);
            }
        }
        ASSERT(children == nodes.size() - 1);
    }
#endif

    /* Registration is done: free the index and lay the child lists out */
    void sortChildren() {
        std::vector<uint32_t>().swap(lookup);
        lookupCount = 0;
        compactHandlers();
        compact();
        buildEdges();
        trim(nodes);
        trim(names);
        trim(handlerLinks);
        trim(methodNodes);

        /* HTTP/1 names its methods in upper case. HTTP/2 and HTTP/3 name them
         * in lower case. The methods are ordered GET first, ANY last and the
         * rest by name, and route() falls back to the last one. That is ANY
         * unless a removal dropped an ANY node that had no route. */
        commonMethod = NONE;
        commonMethodWord = NONE;
        lastMethod = NONE;
        hasMethods = false;
        for (uint32_t method : methodNodes) {
            std::string_view name = nameOf(nodes[method]);
            hasMethods |= name != ANY_METHOD_TOKEN;
            if (name == "GET" || (name == "get" && commonMethod == NONE)) {
                commonMethod = method;
                commonMethodWord = methodWord(name);
            }
            if (lastMethod == NONE || isLaterMethod(name, nameOf(nodes[lastMethod]))) {
                lastMethod = method;
            }
        }
        ready = true;
#if ASSERT_ENABLED
        validate();
#endif
    }

    void insertHandler(uint32_t node, uint32_t handler) {
        uint32_t link = freeHandlerLink;
        if (link != NONE) {
            freeHandlerLink = handlerLinks[link].next;
            handlerLinks[link].handler = handler;
        } else {
            RELEASE_ASSERT(handlerLinks.size() < NONE);
            link = (uint32_t) handlerLinks.size();
            handlerLinks.push_back({handler, NONE});
        }
        /* Insert handler in order sorted by priority (most significant 1 byte) */
        uint32_t *slot = &nodes[node].firstHandler;
        while (*slot != NONE && handlerLinks[*slot].handler <= handler) {
            step();
            slot = &handlerLinks[*slot].next;
        }
        handlerLinks[link].next = *slot;
        *slot = link;
        ready = false;
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
    ALWAYS_INLINE std::pair<std::string_view, bool> getUrlSegment(int urlSegment) {
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

    /* One copy of the parse for the calls that walk a pattern */
    NEVER_INLINE std::pair<std::string_view, bool> getPatternSegment(int segment) {
        return getUrlSegment(segment);
    }

    /* Executes as many handlers it can */
    bool executeHandlers(uint32_t parent, int urlSegment) {
        auto [segment, isStop] = getUrlSegment(urlSegment);
        if (isStop) {
            /* We have reached accross the entire URL with no stoppage, execute */
            for (uint32_t link = nodes[parent].firstHandler; link != NONE; link = handlerLinks[link].next) {
                step();
                ASSERT(handlers[handlerLinks[link].handler & HANDLER_MASK]);
                if (handlers[handlerLinks[link].handler & HANDLER_MASK](this)) {
                    return true;
                }
            }
            /* We reached the end, so go back */
            return false;
        }

        const uint32_t *item = edges.data() + nodes[parent].childList + 1;
        for (const uint32_t *end = item + item[-1]; item != end;) {
            uint32_t word = *item++;
            uint32_t child;
            if (word & STATIC) {
                /* Static match */
                step();
                item += 2;
                if (nameAt(item[-2], word & ~STATIC) != segment) {
                    continue;
                }
                child = item[-1];
            } else if (word & WILDCARD) {
                /* Wildcard match (can be seen as a shortcut). The item has one handler or more. */
                const uint32_t *last = item + (word & ~WILDCARD);
                do {
                    step();
                    ASSERT(item != end && handlers[*item]);
                    if (handlers[*item++](this)) {
                        return true;
                    }
                } while (item != last);
                continue;
            } else if (!word) {
                /* Parameter match */
                step();
                child = *item++;
                if (segment.empty()) {
                    continue;
                }
                routeParameters.push(segment);
                if (executeHandlers(child, urlSegment + 1)) {
                    return true;
                }
                routeParameters.pop();
                continue;
            } else {
                uint32_t count = word & ~STATIC_RUN;
                child = searchRun(item, count, segment);
                item += count * 2;
                if (child == NONE) {
                    continue;
                }
            }
            if (executeHandlers(child, urlSegment + 1)) {
                return true;
            }
        }
        return false;
    }

    /* Walks the pattern down from a method node */
    uint32_t findPattern(uint32_t node, std::string_view pattern, bool isHighPriority) {
        setUrl(pattern);
        for (int i = 0; node != NONE && !getPatternSegment(i).second; i++) {
            std::string_view segment = getPatternSegment(i).first;
            if (segment.starts_with(':')) {
                /* Parameter routes are named only : */
                segment = segment.substr(0, 1);
            }
            /* Go to next segment or quit */
            node = findChild(node, segment, isHighPriority);
        }
        return node;
    }

    /* Scans for one matching handler, returning the handler and its priority or UINT32_MAX for not found */
    uint32_t findHandler(std::string_view method, std::string_view pattern, uint32_t priority) {
        uint32_t node = findChild(ROOT, method, false);
        if (node != NONE) {
            node = findPattern(node, pattern, priority == HIGH_PRIORITY);
        }
        if (node == NONE) {
            return UINT32_MAX;
        }
        /* Seek for a priority match in the found node */
        for (uint32_t link = nodes[node].firstHandler; link != NONE; link = handlerLinks[link].next) {
            if ((handlerLinks[link].handler & ~HANDLER_MASK) == priority) {
                return handlerLinks[link].handler;
            }
        }
        return UINT32_MAX;
    }

    /* A node has the handler once for each time add() named its method */
    bool unlinkHandler(uint32_t node, uint32_t handler) {
        bool found = false;
        for (uint32_t *slot = &nodes[node].firstHandler; *slot != NONE;) {
            step();
            HandlerLink &link = handlerLinks[*slot];
            if (link.handler != handler) {
                slot = &link.next;
                continue;
            }
            uint32_t removed = *slot;
            *slot = link.next;
            link.next = freeHandlerLink;
            freeHandlerLink = removed;
            found = true;
        }
        return found;
    }

    /* The node of a request method. The methods are static children of
     * normal priority. */
    NEVER_INLINE uint32_t findMethod(std::string_view method) {
        const uint32_t *item = edges.data() + nodes[ROOT].childList + 1;
        for (const uint32_t *end = item + item[-1]; item != end; item += 3) {
            uint32_t word = *item;
            if (word & STATIC_RUN) {
                return searchRun(item + 1, word & ~STATIC_RUN, method);
            }
            step();
            ASSERT(word & STATIC);
            if (nameAt(item[1], word & ~STATIC) == method) {
                return item[2];
            }
        }
        return NONE;
    }

public:
    HttpRouter() {
        nodes.push_back({0, 0, NONE, NONE, 0, 0, false, false});
        /* Always have ANY route */
        uint32_t stored = NONE;
        getNode(ROOT, ANY_METHOD_TOKEN, false, stored);
    }

    std::pair<int, std::string_view *> getParameters() {
        return {routeParameters.paramsTop, routeParameters.params};
    }

    UserDataType &getUserData() {
        return userData;
    }

    /* Ends a registration pass. route() needs the child lists that this lays out. */
    void sortRoutes() {
        if (!ready) {
            sortChildren();
        } else if (!lookup.empty()) {
            std::vector<uint32_t>().swap(lookup);
            lookupCount = 0;
        }
    }

    /* Fast path */
    bool route(std::string_view method, std::string_view url) {
        if (!ready) [[unlikely]] {
            sortChildren();
        }

        /* Reset url parsing cache */
        setUrl(url);
        routeParameters.reset();

        /* Begin by finding the method node */
        uint32_t last = lastMethod;
        uint32_t node = NONE;
        if (hasMethods) [[likely]] {
            node = methodWord(method) == commonMethodWord ? commonMethod : findMethod(method);
        } else if (method.size() == ANY_METHOD_TOKEN.size()) {
            /* ANY is the only method, and a request can name ANY itself */
            node = findMethod(method);
        }
        if (node != NONE && executeHandlers(node, 0)) {
            return true;
        }

        /* Always test any route last */
        if (last == NONE) {
            return false;
        }
        return executeHandlers(last, 0);
    }

    /* Adds the corresponding entires in matching tree and handler list */
    void add(std::span<const std::string_view> methods, std::string_view pattern, MoveOnlyFunction<bool(HttpRouter *)> &&handler, uint32_t priority = MEDIUM_PRIORITY) {
        /* First remove existing handler */
        remove(methods[0], pattern, priority);

        if (handlers.size() >= HANDLER_MASK) {
            compactHandlers();
        }
        /* A handler id shares a word with its priority */
        RELEASE_ASSERT(handlers.size() < HANDLER_MASK);

        /* Where this call stored each segment of the pattern in names */
        uint32_t stored[MAX_URL_SEGMENTS];
        std::fill(stored, stored + MAX_URL_SEGMENTS, NONE);

        for (const std::string_view method : methods) {
            /* Lookup method */
            uint32_t storedMethod = NONE;
            uint32_t node = getNode(ROOT, method, false, storedMethod);
            /* Iterate over all segments */
            setUrl(pattern);
            for (int i = 0; !getPatternSegment(i).second; i++) {
                std::string_view segment = getPatternSegment(i).first;
                if (segment.length() > 1 && segment[0] == ':') {
                    /* Parameter routes must be named only : */
                    segment = segment.substr(0, 1);
                }
                node = getNode(node, segment, priority == HIGH_PRIORITY, stored[i]);
            }
            insertHandler(node, priority | (uint32_t) handlers.size());
        }

        /* Alloate this handler */
        handlers.emplace_back(std::move(handler));
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

        /* add() put the handler on the node of this pattern under each of its
         * methods, so no other node can hold it */
        for (size_t i = methodNodes.size(); i-- > 0;) {
            uint32_t node = findPattern(methodNodes[i], pattern, priority == HIGH_PRIORITY);
            if (node != NONE && unlinkHandler(node, handler)) {
                dropIfEmpty(node);
            }
        }

        /* A removal drops every empty node, and an ANY node that nothing was
         * added to is one */
        uint32_t any = findChild(ROOT, ANY_METHOD_TOKEN, false);
        if (any != NONE) {
            dropIfEmpty(any);
        }

        /* Now remove the actual handler */
        handlers[handler & HANDLER_MASK] = nullptr;
        removedHandlers++;
        ready = false;

        return true;
    }
};

}

#endif // UWS_HTTPROUTER_HPP
