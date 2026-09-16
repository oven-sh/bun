/*
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

#include <winsock2.h>
#include <windows.h>

#define LIBUS_SOCKET_READABLE 1
#define LIBUS_SOCKET_WRITABLE 2

struct us_loop_t;

/* Anything that completes through the loop's completion port. It is the first
 * member of the owning struct and its address is what the kernel is given as
 * the OVERLAPPED (or as the ApcContext of an NT call / wait completion packet),
 * so a dequeued lpOverlapped is the op. The owner must stay allocated until
 * `complete` has run for every packet it has in flight: cancelling or closing
 * the handle only requests the completion, it does not wait for it. */
struct us_iocp_op {
    OVERLAPPED overlapped;
    void (*complete)(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry);
    /* The op behind this one in the loop's ready_ops. */
    struct us_iocp_op *next_ready;
};

struct us_internal_afd_poll;
struct us_internal_afd_helper;
struct us_internal_acceptor;

/* Packets taken per GetQueuedCompletionStatusEx call. The call's cost grows
 * with the size of the array it is given, also when the port is empty. */
#define US_IOCP_MAX_ENTRIES 128

/* Same leading fields, in the same order, as the epoll/kqueue us_loop_t: the
 * Rust mirror in src/uws_sys/Loop.rs and the shared C code use them by name. */
struct us_loop_t {
    alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

    /* Number of non-fallthrough polls in the loop */
    int num_polls;

    /* Number of completion packets dequeued this iteration */
    int num_ready_polls;

    /* Current index in the list of dequeued packets */
    int current_ready_poll;

    /* The loop's completion port */
    HANDLE iocp;

    /* Number of polls owned by bun */
    unsigned int bun_polls;

    /* Readiness of the Bun-owned poll being dispatched (LIBUS_SOCKET_* bits),
     * and whether it failed / saw the peer's FIN. */
    int current_ready_events;
    int current_ready_error;
    int current_ready_eof;

    /* \Device\Afd handles the socket polls are issued on, and the polls whose
     * interest changed since the last wait, oldest first: sockets are re-armed
     * in the order they were served, so a busy batch keeps its order instead of
     * reversing it every tick. */
    struct us_internal_afd_helper *afd_helpers;
    struct us_internal_afd_poll *afd_update_head;
    struct us_internal_afd_poll *afd_update_tail;
    /* Listening sockets with an AcceptEx outstanding. */
    struct us_internal_acceptor *acceptors;
    /* A poll cancelled to widen its mask was dequeued and waits for the flush. */
    unsigned char afd_saw_cancelled;
    /* us_loop_free is collecting what is still in flight: nothing is reported or re-armed. */
    unsigned char closing;

    /* Every loop of the process, for waking them when the system resumes. */
    struct us_loop_t *resume_next;
    struct us_loop_t *resume_prev;

    /* Ops submitted and not yet dequeued. The port is closed only at zero. */
    unsigned int pending_ops;

    /* Ops handed to us_iocp_op_ready and not completed yet, oldest first. */
    struct us_iocp_op *ready_ops_head;
    struct us_iocp_op *ready_ops_tail;
    unsigned int num_ready_ops;

    /* Sub-tick wait timeouts: a high-resolution waitable timer delivered into
     * the port by a wait completion packet. NULL where either is unavailable. */
    HANDLE hrtimer;
    HANDLE hrtimer_packet;
    /* When the armed timer is due, on the clock of us_internal_monotonic_ns
     * (which the tick's `now_ns` is a reading of); 0 while it is not armed. */
    uint64_t hrtimer_deadline_ns;

    alignas(LIBUS_EXT_ALIGNMENT) OVERLAPPED_ENTRY ready_polls[US_IOCP_MAX_ENTRIES];
};

struct us_poll_t {
    /* Kernel-visible poll state. Allocated separately because us_poll_resize
     * moves the us_poll_t while a poll may be outstanding. */
    alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_afd_poll *afd;
    /* A listening socket accepts through this instead of being polled. */
    struct us_internal_acceptor *acceptor;
    LIBUS_SOCKET_DESCRIPTOR fd;
    unsigned char poll_type;
};

/* The loop's completion port, for associating handles whose I/O is described
 * by a us_iocp_op. */
HANDLE us_loop_iocp(struct us_loop_t *loop);

/* Accounting for ops the caller submits itself (ReadFile/WriteFile/
 * ConnectNamedPipe/... on a handle associated with us_loop_iocp). Call
 * us_iocp_op_submitted once the kernel has accepted the op (it returned
 * pending, or success without FILE_SKIP_COMPLETION_PORT_ON_SUCCESS); the loop
 * balances it when the packet is dequeued. */
void us_iocp_op_submitted(struct us_loop_t *loop);

/* For an op whose outcome its owner already knows (the call that would have
 * started it failed or finished on the spot) and whose `complete` has to run
 * from the loop all the same. The next tick runs it before it takes packets
 * from the port, in the order of these calls, with an entry that carries the
 * op and nothing else. Loop thread only. Counts as submitted: call
 * us_iocp_op_submitted as for a packet. */
void us_iocp_op_ready(struct us_loop_t *loop, struct us_iocp_op *op);

/* Deliver `op` once when `handle` becomes signalled (process exit, event,
 * console input...). us_iocp_wait_stop returns nonzero if the wait was removed
 * before it fired, in which case `complete` will not run. */
struct us_iocp_wait;
struct us_iocp_wait *us_iocp_wait_create(struct us_loop_t *loop);
int us_iocp_wait_start(struct us_iocp_wait *wait, HANDLE handle, struct us_iocp_op *op);
int us_iocp_wait_stop(struct us_iocp_wait *wait);
void us_iocp_wait_free(struct us_iocp_wait *wait);

/* Socket readiness for a poll Bun owns (`owner` is a tagged pointer handed back
 * through Bun__internal_dispatch_ready_poll, with the readiness in
 * loop->current_ready_*). */
struct us_internal_afd_poll *us_iocp_poll_socket(struct us_loop_t *loop, void *owner, SOCKET socket, int events);
void us_iocp_poll_socket_change(struct us_loop_t *loop, struct us_internal_afd_poll *poll, int events);
void us_iocp_poll_socket_stop(struct us_loop_t *loop, struct us_internal_afd_poll *poll);

#endif // IOCP_H
