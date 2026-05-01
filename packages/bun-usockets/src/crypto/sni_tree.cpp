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

#include <map>
#include <memory>
#include <string_view>
#include <cstring>
#include <cstdlib>
#include <algorithm>

/* We only handle a maximum of 10 labels per hostname */
#define MAX_LABELS 10

/* This cannot be shared */
thread_local void (*sni_free_cb)(void *);

struct sni_node {
    /* Empty nodes must always hold null */
    void *user = nullptr;
    std::map<std::string_view, std::unique_ptr<sni_node>> children;

    ~sni_node() {
        for (auto &p : children) {
            /* The data of our string_views are managed by malloc */
            free((void *) p.first.data());

            /* Call destructor passed to sni_free only if we hold data.
             * This is important since sni_remove does not have sni_free_cb set */
            if (p.second.get()->user) {
                sni_free_cb(p.second.get()->user);
            }
        }
    }
};

// this can only delete ONE single node, but may cull "empty nodes with null as data"
void *removeUser(struct sni_node *root, unsigned int label, std::string_view *labels, unsigned int numLabels) {

    /* If we are in the bottom (past bottom by one), there is nothing to remove */
    if (label == numLabels) {
        void *user = root->user;
        /* Mark us for culling on the way up */
        root->user = nullptr;
        return user;
    }

    /* Is this label a child of root? */
    auto it = root->children.find(labels[label]);
    if (it == root->children.end()) {
        /* We cannot continue */
        return nullptr;
    }

    void *removedUser = removeUser(it->second.get(), label + 1, labels, numLabels);

    /* On the way back up, we may cull empty nodes with no children.
     * This ends up being where we remove all nodes */
    if (it->second.get()->children.empty() && it->second.get()->user == nullptr) {

        /* The data of our string_views are managed by malloc */
        free((void *) it->first.data());

        /* This can only happen with user set to null, otherwise we use sni_free_cb which is unset by sni_remove */
        root->children.erase(it);
    }

    return removedUser;
}

void *getUser(struct sni_node *root, unsigned int label, std::string_view *labels, unsigned int numLabels) {

    /* Do we have labels to match? Otherwise, return where we stand */
    if (label == numLabels) {
        return root->user;
    }

    /* Try and match by our label */
    auto it = root->children.find(labels[label]);
    if (it != root->children.end()) {
        void *user = getUser(it->second.get(), label + 1, labels, numLabels);
        if (user) {
            return user;
        }
    }

    /* Try and match by wildcard */
    it = root->children.find("*");
    if (it == root->children.end()) {
        /* Matching has failed for both label and wildcard */
        return nullptr;
    }

    /* We matched by wildcard */
    return getUser(it->second.get(), label + 1, labels, numLabels);
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
        for (std::string_view view(hostname, strlen(hostname)), label;
            view.length(); view.remove_prefix(std::min(view.length(), label.length() + 1))) {
            /* Label is the token separated by dot */
            label = view.substr(0, view.find('.', 0));

            auto it = root->children.find(label);
            if (it == root->children.end()) {
                /* Duplicate this label for our kept string_view of it */
                void *labelString = malloc(label.length());
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
        struct sni_node *root = (struct sni_node *) sni;

        /* I guess 10 labels is an okay limit */
        std::string_view labels[10];
        unsigned int numLabels = 0;

        /* We traverse all labels first of all */
        for (std::string_view view(hostname, strlen(hostname)), label;
            view.length(); view.remove_prefix(std::min(view.length(), label.length() + 1))) {
            /* Label is the token separated by dot */
            label = view.substr(0, view.find('.', 0));

            /* Anything longer than 10 labels is forbidden */
            if (numLabels == 10) {
                return nullptr;
            }

            labels[numLabels++] = label;
        }

        return removeUser(root, 0, labels, numLabels);
    }

    void *sni_find(void *sni, const char *hostname) {
        struct sni_node *root = (struct sni_node *) sni;

        /* I guess 10 labels is an okay limit */
        std::string_view labels[10];
        unsigned int numLabels = 0;

        /* We traverse all labels first of all */
        for (std::string_view view(hostname, strlen(hostname)), label;
            view.length(); view.remove_prefix(std::min(view.length(), label.length() + 1))) {
            /* Label is the token separated by dot */
            label = view.substr(0, view.find('.', 0));

            /* Anything longer than 10 labels is forbidden */
            if (numLabels == 10) {
                return nullptr;
            }

            labels[numLabels++] = label;
        }

        return getUser(root, 0, labels, numLabels);
    }

}

#endif

#endif