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

#ifndef LIBUS_NO_SSL

#include "libusockets.h"
#include <map>
#include <memory>
#include <string_view>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <utility>
#include <vector>

/* This cannot be shared */
thread_local void (*sni_free_cb)(void *);

struct sni_node {
    /* Empty nodes must always hold null */
    void *user = nullptr;
    std::map<std::string_view, std::unique_ptr<sni_node>> children;

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

    /* Frees what this node owns in its children and moves the child nodes out to `pending` */
    void releaseChildren(std::vector<std::unique_ptr<sni_node>> &pending) {
        for (auto &p : children) {
            /* The data of our string_views are managed by us_malloc */
            us_free((void *) p.first.data());

            /* Call destructor passed to sni_free only if we hold data.
             * This is important since sni_remove does not have sni_free_cb set */
            if (p.second.get()->user) {
                sni_free_cb(p.second.get()->user);
            }

            pending.push_back(std::move(p.second));
        }
        children.clear();
    }
};

/* Splits the first label off a hostname. `rest` is left holding whatever follows the dot.
 * All of sni_add, sni_remove and sni_find must split names the same way. */
static std::string_view nextLabel(std::string_view &rest) {
    std::string_view label = rest.substr(0, rest.find('.', 0));
    rest.remove_prefix(std::min(rest.length(), label.length() + 1));
    return label;
}

// this can only delete ONE single node, but may cull "empty nodes with null as data"
void *removeUser(struct sni_node *root, std::string_view rest) {

    /* The hostname comes from JS and can have any number of labels, so walk down
     * with an explicit path instead of one stack frame per label */
    std::vector<std::pair<struct sni_node *, decltype(root->children)::iterator>> path;

    while (!rest.empty()) {
        /* Is this label a child of root? */
        auto it = root->children.find(nextLabel(rest));
        if (it == root->children.end()) {
            /* We cannot continue */
            return nullptr;
        }

        path.emplace_back(root, it);
        root = it->second.get();
    }

    /* We are in the bottom, take the user and mark us for culling on the way up */
    void *removedUser = root->user;
    root->user = nullptr;

    /* On the way back up, we may cull empty nodes with no children.
     * This ends up being where we remove all nodes */
    for (auto p = path.rbegin(); p != path.rend(); ++p) {
        struct sni_node *parent = p->first;
        auto it = p->second;

        if (!it->second.get()->children.empty() || it->second.get()->user != nullptr) {
            break;
        }

        /* The data of our string_views are managed by us_malloc */
        us_free((void *) it->first.data());

        /* This can only happen with user set to null, otherwise we use sni_free_cb which is unset by sni_remove */
        parent->children.erase(it);
    }

    return removedUser;
}

void *getUser(struct sni_node *root, std::string_view rest) {

    /* Do we have labels to match? Otherwise, return where we stand */
    if (rest.empty()) {
        return root->user;
    }

    std::string_view label = nextLabel(rest);

    /* Try and match by our label */
    auto it = root->children.find(label);
    if (it != root->children.end()) {
        void *user = getUser(it->second.get(), rest);
        if (user) {
            return user;
        }

        /* A literal "*" label already searched the wildcard child above */
        if (label == "*") {
            return nullptr;
        }
    }

    /* Try and match by wildcard */
    it = root->children.find("*");
    if (it == root->children.end()) {
        /* Matching has failed for both label and wildcard */
        return nullptr;
    }

    /* We matched by wildcard */
    return getUser(it->second.get(), rest);
}

extern "C" {

    void *sni_new() {
        return new sni_node;
    }

    void sni_free(void *sni, void (*cb)(void *)) {
        /* We want to run this callback for every remaining name */
        sni_free_cb = cb;

        delete (sni_node *) sni;
    }

    /* Returns non-null if this name already exists */
    int sni_add(void *sni, const char *hostname, void *user) {
        struct sni_node *root = (struct sni_node *) sni;

        /* Traverse all labels in hostname */
        for (std::string_view rest(hostname, strlen(hostname)); rest.length();) {
            std::string_view label = nextLabel(rest);

            auto it = root->children.find(label);
            if (it == root->children.end()) {
                /* Duplicate this label for our kept string_view of it */
                void *labelString = us_malloc(label.length());
                memcpy(labelString, label.data(), label.length());

                it = root->children.emplace(std::string_view((char *) labelString, label.length()),
                                            std::make_unique<sni_node>()).first; // NOLINT(clang-analyzer-unix.Malloc)
            }

            root = it->second.get();
        }

        /* We must never add multiple contexts for the same name, as that would overwrite and leak */
        if (root->user) {
            return 1;
        }

        root->user = user;

        return 0;
    }

    /* Removes the exact match. Wildcards are treated as the verbatim asterisk char, not as an actual wildcard */
    void *sni_remove(void *sni, const char *hostname) {
        return removeUser((struct sni_node *) sni, std::string_view(hostname, strlen(hostname)));
    }

    void *sni_find(void *sni, const char *hostname) {
        return getUser((struct sni_node *) sni, std::string_view(hostname, strlen(hostname)));
    }

}

#endif

#endif