#pragma once
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

#ifndef UWS_LOOP_H
#define UWS_LOOP_H

/* The loop is lazily created per-thread and run with run() */

#include "LoopData.h"
#include <libusockets.h>
#include <iostream>
#include "AsyncSocket.h"

extern "C" int bun_is_exiting();

namespace uWS {
struct Loop {
private:
    static void wakeupCb(us_loop_t *loop) {
        LoopData *loopData = (LoopData *) us_loop_ext(loop);

        /* Swap current deferQueue */
        loopData->deferMutex.lock();
        int oldDeferQueue = loopData->currentDeferQueue;
        loopData->currentDeferQueue = (loopData->currentDeferQueue + 1) % 2;
        loopData->deferMutex.unlock();

        /* Drain the queue */
        for (auto &x : loopData->deferQueues[oldDeferQueue]) {
            x();
        }
        loopData->deferQueues[oldDeferQueue].clear();
    }

    static void preCb(us_loop_t *loop) {
        LoopData *loopData = (LoopData *) us_loop_ext(loop);

        for (auto &p : loopData->preHandlers) {
            p.second((Loop *) loop);
        }

        void *corkedSocket = loopData->getCorkedSocket();
        if (corkedSocket) {
            if (loopData->isCorkedSSL()) {
                ((uWS::AsyncSocket<true> *) corkedSocket)->uncork();
            } else {
                ((uWS::AsyncSocket<false> *) corkedSocket)->uncork();
            }
        }
    }

    static void postCb(us_loop_t *loop) {
        LoopData *loopData = (LoopData *) us_loop_ext(loop);

        for (auto &p : loopData->postHandlers) {
            p.second((Loop *) loop);
        }
    }

    Loop() = delete;
    ~Loop() = default;

    Loop *init() {
        new (us_loop_ext((us_loop_t *) this)) LoopData;
        return this;
    }

    static Loop *create(void *hint) {
        Loop *loop = ((Loop *) us_create_loop(hint, wakeupCb, preCb, postCb, sizeof(LoopData)))->init();

        /* We also need some timers (should live off the one 4 second timer rather) */
        LoopData *loopData = (LoopData *) us_loop_ext((struct us_loop_t *) loop);
        loopData->dateTimer = us_create_timer((struct us_loop_t *) loop, 1, sizeof(LoopData *));
        loopData->updateDate();

        memcpy(us_timer_ext(loopData->dateTimer), &loopData, sizeof(LoopData *));
        us_timer_set(loopData->dateTimer, [](struct us_timer_t *t) {
            LoopData *loopData;
            memcpy(&loopData, us_timer_ext(t), sizeof(LoopData *));
            loopData->updateDate();
        }, 1000, 1000);

        return loop;
    }

    /* What to do with loops created with existingNativeLoop? */
    struct LoopCleaner {
        ~LoopCleaner() {
            // There's no need to call this destructor if Bun is in the process of exiting.
            // This is both a performance thing, and also to prevent freeing some things which are not meant to be freed
            // such as uv_tty_t
            if(loop && cleanMe && !bun_is_exiting()) {
                cleanMe = false;
                loop->free();
            }
        }
        Loop *loop = nullptr;
        bool cleanMe = false;
    };

    static LoopCleaner &getLazyLoop() {
        static thread_local LoopCleaner lazyLoop;
        return lazyLoop;
    }

public:
    /* Lazily initializes a per-thread loop and returns it.
     * Will automatically free all initialized loops at exit. */
    static Loop *get(void *existingNativeLoop = nullptr) {
        if (!getLazyLoop().loop) {
            /* If we are given a native loop pointer we pass that to uSockets and let it deal with it */
            if (existingNativeLoop) {
                /* Todo: here we want to pass the pointer, not a boolean */
                getLazyLoop().loop = create(existingNativeLoop);
                /* We cannot register automatic free here, must be manually done */
            } else {
                getLazyLoop().loop = create(nullptr);
                getLazyLoop().cleanMe = true;
            }
        }

        return getLazyLoop().loop;
    }

    static void clearLoopAtThreadExit() {
        if (getLazyLoop().cleanMe) {
            getLazyLoop().loop->free();
        }
    }

    /* Freeing the default loop should be done once */
    void free() {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        /* Stop and free dateTimer first */
        us_timer_close(loopData->dateTimer, 1);

        loopData->~LoopData();
        /* uSockets will track whether this loop is owned by us or a borrowed alien loop */
        us_loop_free((us_loop_t *) this);

        /* Reset lazyLoop */
        getLazyLoop().loop = nullptr;
    }

    static LoopData* data(struct us_loop_t *loop) {
        return (LoopData *) us_loop_ext(loop);
    }

    void addPostHandler(void *key, MoveOnlyFunction<void(Loop *)> &&handler) {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        loopData->postHandlers.emplace(key, std::move(handler));
    }

    /* Bug: what if you remove a handler while iterating them? */
    void removePostHandler(void *key) {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        loopData->postHandlers.erase(key);
    }

    void addPreHandler(void *key, MoveOnlyFunction<void(Loop *)> &&handler) {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        loopData->preHandlers.emplace(key, std::move(handler));
    }

    /* Bug: what if you remove a handler while iterating them? */
    void removePreHandler(void *key) {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        loopData->preHandlers.erase(key);
    }

    /* Defer this callback on Loop's thread of execution */
    void defer(MoveOnlyFunction<void()> &&cb) {
        LoopData *loopData = (LoopData *) us_loop_ext((us_loop_t *) this);

        //if (std::thread::get_id() == ) // todo: add fast path for same thread id
        loopData->deferMutex.lock();
        loopData->deferQueues[loopData->currentDeferQueue].emplace_back(std::move(cb));
        loopData->deferMutex.unlock();

        us_wakeup_loop((us_loop_t *) this);
    }

    /* Actively block and run this loop */
    void run() {
        us_loop_run((us_loop_t *) this);
    }

    /* Passively integrate with the underlying default loop */
    /* Used to seamlessly integrate with third parties such as Node.js */
    void integrate() {
        us_loop_integrate((us_loop_t *) this);
    }

    /* Dynamically change this */
    void setSilent(bool silent) {
        ((LoopData *) us_loop_ext((us_loop_t *) this))->noMark = silent;
    }
};

/* Can be called from any thread to run the thread local loop */
inline void run() {
    Loop::get()->run();
}

}

#endif // UWS_LOOP_H
