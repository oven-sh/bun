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

#define LIBUS_SOCKET_READABLE 1
#define LIBUS_SOCKET_WRITABLE 2

/* What a poll's descriptor is, which decides how the loop learns that it is ready. */
enum {
    /* A Winsock socket. */
    LIBUS_POLL_KIND_SOCKET = 0,
    /* A kernel object a thread could wait on (process, event, console input). Readable while signaled. */
    LIBUS_POLL_KIND_WAITABLE = 1,
    /* An end of a pipe that Bun created or opened: overlapped, and in nobody else's hands.
     * Pipes are read and written with us_internal_pipe_read and us_internal_pipe_write only. */
    LIBUS_POLL_KIND_PIPE = 2,
    /* A named pipe server. Readable when a client has connected. */
    LIBUS_POLL_KIND_PIPE_LISTENER = 3,
    /* An end of a pipe that came from outside (inherited, or a descriptor the user named). It can be
     * synchronous, and other processes can be using it. */
    LIBUS_POLL_KIND_FOREIGN_PIPE = 4,
};

/* Everything the kernel reports through the port names one of these as its context. It has to stay where
 * it is until on_complete runs, whatever was cancelled or closed in the meantime: the kernel fills `ov` in
 * when the packet is taken off the port, and the packet can be waiting in ready_polls for its turn. */
struct us_internal_iocp_op_t {
    OVERLAPPED ov;
    void (*on_complete)(struct us_loop_t *loop, struct us_internal_iocp_op_t *op);
};

struct us_internal_poll_req_t;
struct us_internal_afd_group_t;

struct us_loop_t {
    alignas(LIBUS_EXT_ALIGNMENT) struct us_internal_loop_data_t data;

    /* Number of non-fallthrough polls in the loop */
    int num_polls;

    /* Number of packets in ready_polls */
    int num_ready_polls;

    /* Index of the next packet to dispatch. A tick that a handler starts carries on from here:
     * a packet is gone from the port once it is in ready_polls. */
    int current_ready_poll;

    /* Unused. The fields up to pending_wakeups are laid out as in epoll_kqueue.h, for src/uws_sys/Loop.rs. */
    int fd;

    /* Number of polls owned by bun */
    unsigned int bun_polls;

    /* Unused: wake_state says whether another thread has woken the loop. */
    unsigned int pending_wakeups;

    HANDLE iocp;

    /* LIBUS_WAKE_*: lets us_internal_async_wakeup skip the system call unless the loop is in its wait. */
    unsigned int wake_state;

    /* Operations whose packet has not been dispatched yet. */
    unsigned int num_inflight_ops;

    /* Every request block of the loop. */
    struct us_internal_poll_req_t *reqs;

    /* Blocks whose interest changed, or whose last event was dispatched. What they ask of the kernel
     * is brought up to date right before the wait. */
    struct us_internal_poll_req_t *update_head, *update_tail;

    /* Blocks that are ready without the kernel having to say so. */
    struct us_internal_poll_req_t *ready_head, *ready_tail;
    /* The part of that list this tick dispatches: what handlers add meanwhile waits for the next one. */
    struct us_internal_poll_req_t *ready_now;

    struct us_internal_afd_group_t *afd_groups;
    struct us_internal_afd_group_t *afd_groups_with_room;
    /* This tick sent again a socket poll that was cancelled to ask for more. */
    int has_resent_polls;

    /* See us_internal_iocp_poll(). */
    unsigned char last_wait_was_short, polls_to_skip, polls_skipped_last;

    /* A port wait is only as precise as the system clock interrupt (15.6 ms). A finite timeout is
     * a high resolution timer whose expiry arrives as a packet. NULL if the system has no such timer. */
    HANDLE timer;
    HANDLE timer_packet;
    /* The packet is waiting on the timer, or is queued on the port. */
    int timer_is_associated;
    /* us_internal_monotonic_ns() at which the timer is set to expire. */
    uint64_t timer_deadline_ns;

    /* For overlapped calls that are waited for on the spot. */
    HANDLE scratch_event;

    /* The list that the resume-from-sleep callback walks. */
    struct us_loop_t *resume_prev, *resume_next;

    alignas(LIBUS_EXT_ALIGNMENT) OVERLAPPED_ENTRY ready_polls[1024];
};

/* src/uws_sys/Poll.rs mirrors this struct, the kinds and the two event bits. */
struct us_poll_t {
    struct {
        /* A SOCKET or a HANDLE, depending on `kind`. */
        LIBUS_SOCKET_DESCRIPTOR fd;
        /* What the kernel has pointers into. Its own allocation, because the poll can be freed or moved
         * (us_poll_resize) while the kernel still does. */
        struct us_internal_poll_req_t *req;
        unsigned char poll_type;
        unsigned char kind;
    } state;
};

void us_internal_poll_set_kind(struct us_poll_t *p, int kind);

/* Lets go of a poll's request block without closing the descriptor. For polls that us_poll_free does not free. */
void us_internal_poll_detach(struct us_poll_t *p);
void us_internal_poll_set_event_on_wait(struct us_poll_t *p, HANDLE event);
void us_internal_poll_read_was_shut_down(struct us_poll_t *p);

/* As recv() and send() on a non-blocking socket: the number of bytes, 0 at the end of the stream, or
 * -1 with the reason in LIBUS_ERR (WSAEWOULDBLOCK, or else a Win32 error).
 * A write that would block has begun all the same. As with SSL_write, the next one has to begin with the same bytes, and
 * is told that they are written. With other bytes it fails, and so does every write after it. */
int us_internal_pipe_read(struct us_loop_t *loop, struct us_poll_t *p, void *buffer, int length);
int us_internal_pipe_write(struct us_loop_t *loop, struct us_poll_t *p, const void *buffer, int length);
/* It all leaves in one write: up to 1 MiB of a stream, and a message whatever its size. */
int us_internal_pipe_writev(struct us_loop_t *loop, struct us_poll_t *p, const struct us_iovec_t *iov, int count);
/* For any poll. The bytes of a write that would block will not be offered again. The peer gets them all the same. */
void us_internal_pipe_disown_write(struct us_poll_t *p);
void us_internal_pipe_shutdown(struct us_poll_t *p);
/* For a poll that was started. Closing it then closes the descriptor, which closes the handle. */
void us_internal_pipe_set_crt_descriptor(struct us_poll_t *p, int crt_descriptor);
/* For any poll: -1 unless it is a pipe that has one. */
int us_internal_pipe_get_crt_descriptor(struct us_poll_t *p);
/* _get_osfhandle() and _close() */
void *Bun__getOSFHandle(int fd);
int Bun__closeOSFHandle(int fd);
/* If the answer is no, this is one more call that waits for the one in progress on the handle. */
int us_internal_pipe_is_overlapped(HANDLE handle);

/* Whether a path names a pipe (\\.\pipe\name) and not a Unix domain socket. */
int us_internal_is_pipe_name(const char *path, size_t length);
void us_internal_pipe_connect(struct us_loop_t *loop, struct us_poll_t *p, const char *path, size_t length);
int us_internal_pipe_listen(struct us_loop_t *loop, struct us_poll_t *p, const char *path, size_t length);
HANDLE us_internal_pipe_accept(struct us_poll_t *p);

#endif // IOCP_H
