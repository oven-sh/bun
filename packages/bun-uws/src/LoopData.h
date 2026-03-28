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

#ifndef UWS_LOOPDATA_H
#define UWS_LOOPDATA_H

#include <cstdint>
#include <ctime>
#include <functional>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

#include <wtf/Assertions.h>

#include "MoveOnlyFunction.h"
#include "PerMessageDeflate.h"
// clang-format off
struct us_timer_t;

namespace uWS {

struct Loop;

struct alignas(16) LoopData {
    friend struct Loop;
private:
    std::mutex deferMutex;
    int currentDeferQueue = 0;
    std::vector<MoveOnlyFunction<void()>> deferQueues[2];

    /* Map from void ptr to handler */
    std::map<void *, MoveOnlyFunction<void(Loop *)>> postHandlers, preHandlers;

    /* Cork data: two independent slots so a nested cork (e.g. a resumed async
     * request writing while the outer request is still corked) doesn't force
     * the outer socket down the uncorked slow path. cork() grabs whichever
     * slot is free; uncork() releases the slot you're in. No ordering. */
    struct CorkSlot {
        char *buffer = nullptr;
        void *socket = nullptr;
        unsigned int offset = 0;
        unsigned int ssl : 1 = 0;
    };

    CorkSlot corkSlots[2];

    /* 1 = slot 1 was touched most recently, 0 = slot 0. Used to pick the LRU
     * victim when both slots have data and we must force-uncork one. */
    unsigned int lastTouchedSlot1 : 1 = 0;

public:
    /* INVALID_CORK_SLOT means "not corked with us". */
    static constexpr int INVALID_CORK_SLOT = -1;

    LoopData() {
        corkSlots[0].buffer = new char[CORK_BUFFER_SIZE];
        corkSlots[1].buffer = new char[CORK_BUFFER_SIZE];
        updateDate();
    }

    ~LoopData() {
        /* If we have had App.ws called with compression we need to clear this */
        if (zlibContext) {
            delete zlibContext;
            delete inflationStream;
            delete deflationStream;
        }
        delete [] corkSlots[0].buffer;
        delete [] corkSlots[1].buffer;
    }

    /* Returns the slot index this socket is corked in, or INVALID_CORK_SLOT. */
    int findCorkSlot(void *socket) {
        if (corkSlots[0].socket == socket) return 0;
        if (corkSlots[1].socket == socket) return 1;
        return INVALID_CORK_SLOT;
    }

    /* Returns a slot we can borrow: prefers a free slot, falls back to a
     * borrowed-but-unwritten slot (offset == 0) that we can steal without
     * flushing. Returns INVALID_CORK_SLOT only if both slots hold data. */
    int findBorrowableCorkSlot() {
        if (corkSlots[0].socket == nullptr) return 0;
        if (corkSlots[1].socket == nullptr) return 1;
        if (corkSlots[0].offset == 0) return 0;
        if (corkSlots[1].offset == 0) return 1;
        return INVALID_CORK_SLOT;
    }

    /* Borrow a slot for this socket. Returns the slot index, or
     * INVALID_CORK_SLOT if both slots have data that must be flushed. */
    int acquireCorkSlot(void *socket, bool ssl) {
        int slot = findBorrowableCorkSlot();
        if (slot != INVALID_CORK_SLOT) {
            corkSlots[slot].socket = socket;
            corkSlots[slot].ssl = ssl;
            corkSlots[slot].offset = 0;
            lastTouchedSlot1 = (slot == 1);
        }
        return slot;
    }

    /* Mark a slot as recently used. Call when writing into it so LRU eviction
     * picks the other slot. */
    void touchCorkSlot(int slot) {
        lastTouchedSlot1 = (slot == 1);
    }

    /* Returns the least-recently-used slot index for force-uncork eviction. */
    int getLRUCorkSlot() {
        return lastTouchedSlot1 ? 0 : 1;
    }

    /* Release a slot. */
    void releaseCorkSlot(int slot) {
        ASSERT(slot == 0 || slot == 1);
        corkSlots[slot].socket = nullptr;
        corkSlots[slot].offset = 0;
    }

    /* Transfer ownership of a slot to a new socket (used during WebSocket
     * upgrade to hand the HTTP socket's cork buffer to the new WebSocket). */
    void transferCorkSlot(int slot, void *socket, bool ssl) {
        ASSERT(slot == 0 || slot == 1);
        corkSlots[slot].socket = socket;
        corkSlots[slot].ssl = ssl;
    }

    CorkSlot *getCorkSlot(int slot) {
        ASSERT(slot == 0 || slot == 1);
        return &corkSlots[slot];
    }

    bool canCork() {
        return findBorrowableCorkSlot() != INVALID_CORK_SLOT;
    }

    /* Remove this socket from any cork slot it occupies. Must be called from
     * socket close/destroy paths to avoid leaving a dangling pointer that the
     * drain loop would later dereference. */
    void unborrowCorkSlot(void *socket) {
        if (corkSlots[0].socket == socket) { corkSlots[0].socket = nullptr; corkSlots[0].offset = 0; }
        if (corkSlots[1].socket == socket) { corkSlots[1].socket = nullptr; corkSlots[1].offset = 0; }
    }

    /* Legacy accessor for drain loops: returns any corked socket (slot 0 first)
     * so the caller can uncork it. Returns nullptr if both slots are empty. */
    void *getAnyCorkedSocket(bool *outSsl) {
        if (corkSlots[0].socket) { *outSsl = corkSlots[0].ssl; return corkSlots[0].socket; }
        if (corkSlots[1].socket) { *outSsl = corkSlots[1].ssl; return corkSlots[1].socket; }
        return nullptr;
    }

    void updateDate() {
        time_t now = time(0);
        struct tm tstruct = {};
#ifdef _WIN32
        gmtime_s(&tstruct, &now);
#else
        gmtime_r(&now, &tstruct);
#endif
        static const char wday_name[][4] = {
            "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
        };
        static const char mon_name[][4] = {
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        };
        snprintf(date, 32, "%.3s, %.2u %.3s %.4u %.2u:%.2u:%.2u GMT",
            wday_name[tstruct.tm_wday],
            tstruct.tm_mday % 99,
            mon_name[tstruct.tm_mon],
            (1900 + tstruct.tm_year) % 9999,
            tstruct.tm_hour % 99,
            tstruct.tm_min % 99,
            tstruct.tm_sec % 99);
    }

    char date[32];

    /* Be silent */
    bool noMark = false;

    /* Good 16k for SSL perf. */
    static const unsigned int CORK_BUFFER_SIZE = 16 * 1024;

    /* Per message deflate data */
    ZlibContext *zlibContext = nullptr;
    InflationStream *inflationStream = nullptr;
    DeflationStream *deflationStream = nullptr;
};

}

#endif // UWS_LOOPDATA_H
