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

#ifndef LOOP_DATA_H
#define LOOP_DATA_H

#include <stdint.h>

#if defined(__APPLE__)
#include <os/lock.h>
typedef os_unfair_lock zig_mutex_t;
#elif defined(__linux__)
typedef uint32_t zig_mutex_t;
#elif defined(_WIN32)
// SRWLOCK
typedef void* zig_mutex_t;
#else
#error "Unsupported platform"
#endif

// IMPORTANT: When changing this, don't forget to update the zig version in uws.zig as well!
struct us_internal_loop_data_t {
    struct us_timer_t *sweep_timer;
    int sweep_timer_count;
    struct us_internal_async *wakeup_async;
    struct us_socket_context_t *head;
    struct us_socket_context_t *iterator;
    struct us_socket_context_t *closed_context_head;
    char *recv_buf;
    char *send_buf;
    void *ssl_data;
    void (*pre_cb)(struct us_loop_t *);
    void (*post_cb)(struct us_loop_t *);
    struct us_udp_socket_t *closed_udp_head;
    struct us_socket_t *closed_head;
    struct us_socket_t *low_prio_head;
    int low_prio_budget;
    struct us_connecting_socket_t *dns_ready_head;
    struct us_connecting_socket_t *closed_connecting_head;
    zig_mutex_t mutex;
    void *parent_ptr;
    char parent_tag;
    /* We do not care if this flips or not, it doesn't matter */
    size_t iteration_nr;
    void* jsc_vm;
};

#endif // LOOP_DATA_H
