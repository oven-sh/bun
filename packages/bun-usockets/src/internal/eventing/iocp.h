/*
 * Authored by Alex Hultman, 2018-2019.
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

#ifndef IOCP_H
#define IOCP_H

#include "internal/loop_data.h"

/* The functions of this backend are in src/uws_sys/iocp.rs, which mirrors what is below. */

#define LIBUS_SOCKET_READABLE 1
#define LIBUS_SOCKET_WRITABLE 2

struct us_loop_t {
    alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

    /* Number of non-fallthrough polls in the loop */
    int num_polls;

    /* Number of ready polls this iteration */
    int num_ready_polls;

    /* Number of polls owned by bun */
    unsigned int bun_polls;

    /* Incremented atomically by wakeup(), swapped to 0 before the wait.
     * If non-zero, the event loop will return immediately so we can skip the GC safepoint. */
    unsigned int pending_wakeups;

    /* Whether a socket was written to since the last wait */
    int has_sent;

    void *port;
};

struct us_poll_t {
    alignas(LIBUS_EXT_ALIGNMENT) void *opaque[4];
};

#endif // IOCP_H
