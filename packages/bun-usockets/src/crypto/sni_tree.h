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

/* This Server Name Indication hostname tree is written in C++ but could be ported to C.
 * Overall it looks like crap, but has no memory allocations in fast path and is O(log n). */

#ifndef SNI_TREE_H
#define SNI_TREE_H

#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <algorithm>
#include <utility>
#include <vector>

/* RFC 6066 section 3: host names compare ASCII case-insensitively */
struct sni_label_less {
    using is_transparent = void;

    static unsigned char fold(unsigned char c) {
        return c >= 'A' && c <= 'Z' ? c + ('a' - 'A') : c;
    }

    bool operator()(std::string_view a, std::string_view b) const {
        return std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end(), [](char x, char y) {
            return fold(x) < fold(y);
        });
    }
};

template <typename T>
struct sni_node {
    /* Empty nodes must always hold null */
    T user{};
    std::map<std::string, std::unique_ptr<sni_node>, sni_label_less> children;

    ~sni_node() {
        /* A name from JS can have any number of labels, so tear the subtree down
         * with an explicit stack instead of one destructor frame per label */
        std::vector<std::unique_ptr<sni_node>> pending;
        releaseChildren(pending);
        while (!pending.empty()) {
            std::unique_ptr<sni_node> node = std::move(pending.back());
            pending.pop_back();
            node->releaseChildren(pending);
        }
    }

    /* Moves the child nodes out to `pending` */
    void releaseChildren(std::vector<std::unique_ptr<sni_node>> &pending) {
        for (auto &p : children) {
            pending.push_back(std::move(p.second));
        }
        children.clear();
    }

    /* Splits the first label off a hostname. `rest` is left holding whatever follows the dot.
     * add and find must split names the same way. */
    static std::string_view nextLabel(std::string_view &rest) {
        std::string_view label = rest.substr(0, rest.find('.', 0));
        rest.remove_prefix(std::min(rest.length(), label.length() + 1));
        return label;
    }

    const T *find(std::string_view rest) const {

        /* Do we have labels to match? Otherwise, return where we stand */
        if (rest.empty()) {
            return user ? &user : nullptr;
        }

        std::string_view label = nextLabel(rest);

        /* Try and match by our label */
        auto it = children.find(label);
        if (it != children.end()) {
            const T *found = it->second->find(rest);
            if (found) {
                return found;
            }

            /* A literal "*" label already searched the wildcard child above */
            if (label == "*") {
                return nullptr;
            }
        }

        /* Try and match by wildcard */
        it = children.find("*");
        if (it == children.end()) {
            /* Matching has failed for both label and wildcard */
            return nullptr;
        }

        /* We matched by wildcard */
        return it->second->find(rest);
    }

    /* The last registration of a name wins */
    void add(std::string_view rest, T value) {
        sni_node *root = this;

        /* Traverse all labels in hostname */
        while (rest.length()) {
            std::string_view label = nextLabel(rest);

            auto it = root->children.find(label);
            if (it == root->children.end()) {
                it = root->children.emplace(label, std::make_unique<sni_node>()).first;
            }

            root = it->second.get();
        }

        root->user = std::move(value);
    }
};

#endif
