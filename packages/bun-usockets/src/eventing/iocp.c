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

/* The Windows backend. It has the shape of epoll_kqueue.c: polls report level-triggered readiness and the
 * caller does the reading and writing itself. Windows only has completions, so each kind of descriptor
 * (LIBUS_POLL_KIND_*) has an operation that completes when the descriptor is ready and moves no data. */

#include "libusockets.h"
#include "internal/internal.h"
#include "internal/fault_inject.h"

#ifdef LIBUS_USE_IOCP

#include "internal/eventing/iocp_internal.h"
#include <mswsock.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

void Bun__internal_dispatch_ready_poll(void *loop, void *poll, int events, int error, int eof);

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec *timeout, uint64_t now_ns);

/* src/uws_sys/Loop.rs passes a pair of 64-bit integers. */
_Static_assert(sizeof(struct timespec) == 16, "struct timespec is not two 64-bit slots");

/* Keys of the packets that have no operation as their context. */
#define LIBUS_IOCP_KEY_WAKE 1
#define LIBUS_IOCP_KEY_TIMER 2

enum {
    LIBUS_WAKE_AWAKE = 0,
    LIBUS_WAKE_SLEEPING = 1,
    LIBUS_WAKE_NOTIFIED = 2,
};

/* Asking the kernel for more than 16 packets makes it allocate, at a cost that grows with the number.
 * This many cost next to nothing, and a loop that fills them asks for more. */
#define LIBUS_FIRST_READY_POLLS 64

/* Request blocks */

void us_internal_iocp_req_init(struct us_internal_poll_req_t *req, struct us_loop_t *loop, struct us_poll_t *owner) {
    req->owner = owner;
    req->loop = loop;
    req->kind = owner->state.kind;
    req->next = loop->reqs;
    if (loop->reqs) {
        loop->reqs->prev = req;
    }
    loop->reqs = req;
    owner->state.req = req;
}

void us_internal_iocp_queue_update(struct us_internal_poll_req_t *req) {
    if (req->is_queued_for_update) {
        return;
    }
    req->is_queued_for_update = 1;
    struct us_loop_t *loop = req->loop;
    if (loop->update_tail) {
        loop->update_tail->update_next = req;
    } else {
        loop->update_head = req;
    }
    loop->update_tail = req;
}

void us_internal_iocp_queue_ready(struct us_internal_poll_req_t *req) {
    if (req->is_queued_as_ready) {
        return;
    }
    req->is_queued_as_ready = 1;
    struct us_loop_t *loop = req->loop;
    if (loop->ready_tail) {
        loop->ready_tail->ready_next = req;
    } else {
        loop->ready_head = req;
    }
    loop->ready_tail = req;
}

void us_internal_iocp_dispatch(struct us_loop_t *loop, struct us_poll_t *p, int error, int eof, int events) {
    events &= us_poll_events(p);
    if (!events && !error && !eof) {
        return;
    }
    if (us_internal_poll_type(p) == POLL_TYPE_FILE_POLL) {
        Bun__internal_dispatch_ready_poll(loop, p, events, error, eof);
    } else {
        us_internal_dispatch_ready_poll(p, error, eof, events);
    }
}

/* Sockets
 *
 * IOCTL_AFD_POLL is what select() and WSAPoll() are made of: it completes when one of the events it asks
 * about holds for the socket, at once if one already does. It is sent to a helper handle on the same driver
 * rather than to the socket, so that the socket itself never gets bound to the port.
 *
 * A thread must not have two of them outstanding for one socket: the older one then completes for events
 * only the younger one asked about, and the younger one never completes. So a poll that has to ask for more
 * is cancelled, and sent again only when the packet of the cancelled one has arrived. The tick that sends it
 * again looks at the port once more, so the change of interest takes effect in one iteration as with epoll.
 *
 * The helper handles, their groups and the search for the base socket are derived from wepoll (BSD-2-Clause,
 * Copyright 2012-2020 Bert Belder):
 * https://github.com/piscisaureus/wepoll/blob/0598a791bf9cbbf480793d778930fc635b044980/wepoll.c#L328 */

#define IOCTL_AFD_POLL 0x00012024

#define AFD_POLL_RECEIVE 0x0001
#define AFD_POLL_SEND 0x0004
/* The peer sent FIN. Data can still be queued in front of it. */
#define AFD_POLL_DISCONNECT 0x0008
/* The connection was reset. What was queued is gone. */
#define AFD_POLL_ABORT 0x0010
/* The last handle to the socket was closed. Reported whether asked for or not. */
#define AFD_POLL_LOCAL_CLOSE 0x0020
#define AFD_POLL_ACCEPT 0x0080
#define AFD_POLL_CONNECT_FAIL 0x0100

typedef struct {
    HANDLE Handle;
    ULONG Events;
    NTSTATUS Status;
} AFD_POLL_HANDLE_INFO;

typedef struct {
    LARGE_INTEGER Timeout;
    ULONG NumberOfHandles;
    ULONG Exclusive;
    AFD_POLL_HANDLE_INFO Handles[1];
} AFD_POLL_INFO;

/* Cancelling walks every request outstanding on the helper, so its cost grows with their number. */
#define LIBUS_AFD_GROUP_SIZE 32

struct us_internal_afd_group_t {
    HANDLE helper;
    unsigned int num_users;
    struct us_internal_afd_group_t *next;
    struct us_internal_afd_group_t *next_with_room;
};

enum {
    LIBUS_AFD_IDLE = 0,
    LIBUS_AFD_IN_KERNEL,
    LIBUS_AFD_CANCELLING,
};

struct us_internal_afd_req_t {
    struct us_internal_poll_req_t req;
    struct us_internal_iocp_op_t op;
    /* Both the request and the answer. */
    AFD_POLL_INFO info;
    /* A request can only be cancelled on the helper it was sent to. */
    struct us_internal_afd_group_t *group;
    SOCKET base_socket;
    /* What the request in the kernel asks about. */
    ULONG armed_events;
    unsigned char state;
    /* The kernel would not take the request. */
    unsigned char was_refused;
    /* See us_internal_poll_read_was_shut_down. */
    unsigned char read_is_shut_down;
};

static struct us_internal_afd_group_t *us_internal_afd_group_acquire(struct us_loop_t *loop) {
    struct us_internal_afd_group_t *group = loop->afd_groups_with_room;
    if (!group) {
        static WCHAR name[] = L"\\Device\\Afd\\Bun";
        UNICODE_STRING path = { sizeof(name) - sizeof(WCHAR), sizeof(name), name };
        OBJECT_ATTRIBUTES attributes;
        InitializeObjectAttributes(&attributes, &path, 0, NULL, NULL);
        IO_STATUS_BLOCK io_status;
        HANDLE helper;
        NTSTATUS status = NtCreateFile(&helper, SYNCHRONIZE, &attributes, &io_status, NULL, 0,
            FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN, 0, NULL, 0);
        if (status != STATUS_SUCCESS) {
            SetLastError(RtlNtStatusToDosError(status));
            return NULL;
        }
        if (!CreateIoCompletionPort(helper, loop->iocp, 0, 0)) {
            DWORD error = GetLastError();
            CloseHandle(helper);
            SetLastError(error);
            return NULL;
        }
        SetFileCompletionNotificationModes(helper, FILE_SKIP_SET_EVENT_ON_HANDLE);

        group = us_xcalloc(1, sizeof(struct us_internal_afd_group_t));
        group->helper = helper;
        group->next = loop->afd_groups;
        loop->afd_groups = group;
        loop->afd_groups_with_room = group;
    }
    if (++group->num_users == LIBUS_AFD_GROUP_SIZE) {
        loop->afd_groups_with_room = group->next_with_room;
        group->next_with_room = NULL;
    }
    return group;
}

static void us_internal_afd_group_release(struct us_loop_t *loop, struct us_internal_afd_group_t *group) {
    if (group->num_users-- == LIBUS_AFD_GROUP_SIZE) {
        group->next_with_room = loop->afd_groups_with_room;
        loop->afd_groups_with_room = group;
    }
}

/* The driver only knows the handle at the bottom of the stack of layered service providers. */
static SOCKET us_internal_afd_base_socket(SOCKET socket) {
    for (;;) {
        SOCKET base;
        DWORD bytes;
        if (WSAIoctl(socket, SIO_BASE_HANDLE, NULL, 0, &base, sizeof(base), &bytes, NULL, NULL) == 0) {
            return base;
        }
        int error = WSAGetLastError();
        if (error == WSAENOTSOCK) {
            return INVALID_SOCKET;
        }
        /* Some providers refuse SIO_BASE_HANDLE so as not to be bypassed. This one answers with the
         * handle of the next layer down. */
        if (WSAIoctl(socket, SIO_BSP_HANDLE_POLL, NULL, 0, &base, sizeof(base), &bytes, NULL, NULL) != 0 || base == socket) {
            WSASetLastError(error);
            return INVALID_SOCKET;
        }
        socket = base;
    }
}

static int us_internal_afd_start(struct us_loop_t *loop, struct us_poll_t *p) {
    /* A socket that this process inherited can be the first that Winsock hears of. */
    bsd_winsock_ensure();
    SOCKET base_socket = us_internal_afd_base_socket(p->state.fd);
    if (base_socket == INVALID_SOCKET) {
        return -1;
    }
    struct us_internal_afd_group_t *group = us_internal_afd_group_acquire(loop);
    if (!group) {
        return -1;
    }
    struct us_internal_afd_req_t *afd = us_xcalloc(1, sizeof(struct us_internal_afd_req_t));
    us_internal_iocp_req_init(&afd->req, loop, p);
    afd->group = group;
    afd->base_socket = base_socket;
    return 0;
}

static ULONG us_internal_afd_wanted_events(struct us_internal_afd_req_t *afd, struct us_poll_t *p) {
    const int events = us_poll_events(p);
    const int type = us_internal_poll_type(p);
    if (!events && type == POLL_TYPE_FILE_POLL) {
        return 0;
    }
    /* What epoll reports unasked, as EPOLLERR. */
    ULONG wanted = AFD_POLL_ABORT | AFD_POLL_LOCAL_CLOSE;
    if (events & LIBUS_SOCKET_READABLE) {
        wanted |= AFD_POLL_RECEIVE | AFD_POLL_ACCEPT | AFD_POLL_DISCONNECT;
    } else if (type == POLL_TYPE_SOCKET_SHUT_DOWN && !afd->req.hangup_was_reported) {
        /* What epoll reports unasked as EPOLLHUP: both directions are down. */
        wanted |= AFD_POLL_DISCONNECT;
    }
    if (events & LIBUS_SOCKET_WRITABLE) {
        wanted |= AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL;
    }
    return wanted;
}

static void us_internal_afd_update(struct us_internal_afd_req_t *afd);

static void us_internal_afd_on_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_afd_req_t *afd = (struct us_internal_afd_req_t *) ((char *) op - offsetof(struct us_internal_afd_req_t, op));
    us_internal_iocp_op_finished(&afd->req);
    afd->state = LIBUS_AFD_IDLE;

    struct us_poll_t *p = afd->req.owner;
    if (!p) {
        us_internal_iocp_req_free_if_unused(&afd->req);
        return;
    }

    const NTSTATUS status = (NTSTATUS) op->ov.Internal;
    if (status == STATUS_CANCELLED) {
        us_internal_afd_update(afd);
        loop->has_resent_polls = 1;
        return;
    }

    ULONG reported = 0;
    int error = 0;
    if (status == STATUS_SUCCESS) {
        /* No handle: an exclusive poll for this socket, from another thread or process, replaced ours. */
        if (afd->info.NumberOfHandles >= 1) {
            reported = afd->info.Handles[0].Events;
        }
    } else {
        error = 1;
    }

    if (reported & AFD_POLL_LOCAL_CLOSE) {
        /* Closed without us_poll_stop. */
        p->state.fd = LIBUS_SOCKET_ERROR;
        us_internal_iocp_dispatch(loop, p, 1, 0, 0);
        return;
    }

    /* Asking again, which answers at once while the event still holds, is what makes polls level-triggered. */
    us_internal_iocp_queue_update(&afd->req);

    int events = 0;
    int eof = 0;
    if (reported & (AFD_POLL_RECEIVE | AFD_POLL_ACCEPT)) {
        events |= LIBUS_SOCKET_READABLE;
    }
    if (reported & AFD_POLL_DISCONNECT) {
        if (us_poll_events(p) & LIBUS_SOCKET_READABLE) {
            /* recv() returns what is queued and then 0. */
            events |= LIBUS_SOCKET_READABLE;
        } else if (us_internal_poll_type(p) == POLL_TYPE_SOCKET_SHUT_DOWN && !afd->req.hangup_was_reported) {
            afd->req.hangup_was_reported = 1;
            eof = LIBUS_POLL_HANGUP;
        }
    }
    if ((reported & (AFD_POLL_ABORT | AFD_POLL_CONNECT_FAIL)) == AFD_POLL_ABORT && us_internal_poll_type(p) == POLL_TYPE_SEMI_SOCKET) {
        /* It was connected first, and the owner hears of the two in that order. */
        events |= LIBUS_SOCKET_WRITABLE;
    } else if (reported & AFD_POLL_ABORT) {
        /* As with epoll. An owner that only looks at these two, like c-ares, finds the error in recv() or send(). */
        events |= LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE;
        error = 1;
    }
    if (reported & AFD_POLL_SEND) {
        events |= LIBUS_SOCKET_WRITABLE;
    }
    if (reported & AFD_POLL_CONNECT_FAIL) {
        events |= LIBUS_SOCKET_WRITABLE;
        error = 1;
    }
    us_internal_iocp_dispatch(loop, p, error, eof, events);
}

static void us_internal_afd_cancel(struct us_internal_afd_req_t *afd) {
    /* Whatever this returns, the packet still comes: the request may have completed already. */
    IO_STATUS_BLOCK io_status;
    NtCancelIoFileEx(afd->group->helper, (PIO_STATUS_BLOCK) &afd->op.ov.Internal, &io_status);
    afd->state = LIBUS_AFD_CANCELLING;
}

static void us_internal_afd_update(struct us_internal_afd_req_t *afd) {
    if (afd->read_is_shut_down && (us_poll_events(afd->req.owner) & LIBUS_SOCKET_READABLE)) {
        us_internal_iocp_queue_ready(&afd->req);
    }
    const ULONG wanted = us_internal_afd_wanted_events(afd, afd->req.owner);
    if (afd->state == LIBUS_AFD_IN_KERNEL) {
        /* A request that asks about too much is left alone: dispatch drops what is not polled for. */
        if (wanted & ~afd->armed_events) {
            us_internal_afd_cancel(afd);
        }
        return;
    }
    if (afd->state == LIBUS_AFD_CANCELLING || !wanted) {
        return;
    }

    afd->info.Timeout.QuadPart = INT64_MAX;
    afd->info.NumberOfHandles = 1;
    afd->info.Exclusive = FALSE;
    afd->info.Handles[0].Handle = (HANDLE) afd->base_socket;
    afd->info.Handles[0].Events = wanted;
    afd->info.Handles[0].Status = 0;
    memset(&afd->op.ov, 0, sizeof(afd->op.ov));
    afd->op.on_complete = us_internal_afd_on_complete;

    NTSTATUS status = NtDeviceIoControlFile(afd->group->helper, NULL, NULL, &afd->op, (PIO_STATUS_BLOCK) &afd->op.ov.Internal,
        IOCTL_AFD_POLL, &afd->info, sizeof(afd->info), &afd->info, sizeof(afd->info));
    /* A request that is answered at once queues its packet like any other. A refused one queues none. */
    if (status == STATUS_SUCCESS || status == (NTSTATUS) STATUS_PENDING) {
        us_internal_iocp_op_started(&afd->req);
        afd->state = LIBUS_AFD_IN_KERNEL;
        afd->armed_events = wanted;
    } else {
        afd->was_refused = 1;
        us_internal_iocp_queue_ready(&afd->req);
    }
}

static void us_internal_afd_ready(struct us_internal_afd_req_t *afd) {
    if (afd->was_refused) {
        afd->was_refused = 0;
        us_internal_iocp_dispatch(afd->req.loop, afd->req.owner, 1, 0, 0);
        return;
    }
    /* Asked again after the handler: readiness is level-triggered. */
    us_internal_iocp_queue_update(&afd->req);
    us_internal_iocp_dispatch(afd->req.loop, afd->req.owner, 0, 0, LIBUS_SOCKET_READABLE);
}

/* After shutdown(SD_RECEIVE). The driver reports nothing for it, where epoll reports a socket that can be read to its end.
 * There is no such call for a pipe. */
void us_internal_poll_read_was_shut_down(struct us_poll_t *p) {
    if (us_internal_poll_is_pipe(p)) {
        us_internal_pipe_shutdown_read(p);
        return;
    }
    struct us_internal_afd_req_t *afd = (struct us_internal_afd_req_t *) p->state.req;
    if (afd) {
        afd->read_is_shut_down = 1;
        us_internal_iocp_queue_update(&afd->req);
    }
}

/* Closing the socket would not do: the request outlives it while a child process or a duplicate holds the socket open. */
static void us_internal_afd_stop(struct us_internal_afd_req_t *afd) {
    if (afd->state == LIBUS_AFD_IN_KERNEL) {
        us_internal_afd_cancel(afd);
    }
}

/* Waitable handles */

struct us_internal_waitable_req_t {
    struct us_internal_poll_req_t req;
    struct us_internal_iocp_op_t op;
    HANDLE packet;
    /* See us_internal_poll_set_event_on_wait. */
    HANDLE event_on_wait;
    unsigned char is_armed;
};

static int us_internal_waitable_start(struct us_loop_t *loop, struct us_poll_t *p) {
    HANDLE packet;
    NTSTATUS status = NtCreateWaitCompletionPacket(&packet, LIBUS_WAIT_COMPLETION_PACKET_ALL_ACCESS, NULL);
    if (status != STATUS_SUCCESS) {
        SetLastError(RtlNtStatusToDosError(status));
        return -1;
    }
    struct us_internal_waitable_req_t *waitable = us_xcalloc(1, sizeof(struct us_internal_waitable_req_t));
    us_internal_iocp_req_init(&waitable->req, loop, p);
    waitable->packet = packet;
    return 0;
}

static void us_internal_waitable_on_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_waitable_req_t *waitable = (struct us_internal_waitable_req_t *) ((char *) op - offsetof(struct us_internal_waitable_req_t, op));
    us_internal_iocp_op_finished(&waitable->req);
    waitable->is_armed = 0;

    struct us_poll_t *p = waitable->req.owner;
    if (!p) {
        us_internal_iocp_req_free_if_unused(&waitable->req);
        return;
    }
    us_internal_iocp_queue_update(&waitable->req);
    us_internal_iocp_dispatch(loop, p, 0, 0, LIBUS_SOCKET_READABLE);
}

/* For a handle that a helper thread signals, such as the one that reads the console. `event` lets that thread read on.
 * It is set right before the wait, and only if `p` is still polled for reading: a handler may read the console itself,
 * or start a child that does. */
void us_internal_poll_set_event_on_wait(struct us_poll_t *p, HANDLE event) {
    struct us_internal_waitable_req_t *waitable = (struct us_internal_waitable_req_t *) p->state.req;
    waitable->event_on_wait = event;
    us_internal_iocp_queue_update(&waitable->req);
}

static void us_internal_waitable_update(struct us_internal_waitable_req_t *waitable) {
    struct us_poll_t *p = waitable->req.owner;
    if (!(us_poll_events(p) & LIBUS_SOCKET_READABLE)) {
        return;
    }
    if (waitable->event_on_wait) {
        SetEvent(waitable->event_on_wait);
        waitable->event_on_wait = NULL;
    }
    if (waitable->is_armed) {
        return;
    }
    waitable->op.on_complete = us_internal_waitable_on_complete;
    NTSTATUS status = NtAssociateWaitCompletionPacket(waitable->packet, waitable->req.loop->iocp, (HANDLE) p->state.fd,
        NULL, &waitable->op, STATUS_SUCCESS, 0, NULL);
    if (status == STATUS_SUCCESS) {
        us_internal_iocp_op_started(&waitable->req);
        waitable->is_armed = 1;
    } else {
        us_internal_iocp_queue_ready(&waitable->req);
    }
}

static void us_internal_waitable_stop(struct us_internal_waitable_req_t *waitable) {
    if (waitable->is_armed && NtCancelWaitCompletionPacket(waitable->packet, TRUE) == STATUS_SUCCESS) {
        us_internal_iocp_op_finished(&waitable->req);
        waitable->is_armed = 0;
    }
}

/* Request blocks, by kind */

void us_internal_iocp_req_free_if_unused(struct us_internal_poll_req_t *req) {
    if (req->owner || req->num_inflight_ops || req->is_queued_for_update || req->is_queued_as_ready) {
        return;
    }
    struct us_loop_t *loop = req->loop;
    if (req->prev) {
        req->prev->next = req->next;
    } else {
        loop->reqs = req->next;
    }
    if (req->next) {
        req->next->prev = req->prev;
    }
    switch (req->kind) {
    case LIBUS_POLL_KIND_SOCKET:
        us_internal_afd_group_release(loop, ((struct us_internal_afd_req_t *) req)->group);
        break;
    case LIBUS_POLL_KIND_WAITABLE:
        CloseHandle(((struct us_internal_waitable_req_t *) req)->packet);
        break;
    default:
        us_internal_pipe_destroy(req);
        break;
    }
    us_free(req);
}

/* Brings what the kernel is asked in line with what the polls want. Handlers change their mind several times
 * per event (us_poll_change), and only the outcome costs a system call. Runs no handlers. */
static void us_internal_iocp_flush_updates(struct us_loop_t *loop) {
    struct us_internal_poll_req_t *req;
    while ((req = loop->update_head)) {
        loop->update_head = req->update_next;
        if (!loop->update_head) {
            loop->update_tail = NULL;
        }
        req->update_next = NULL;
        req->is_queued_for_update = 0;
        if (!req->owner) {
            us_internal_iocp_req_free_if_unused(req);
            continue;
        }
        switch (req->kind) {
        case LIBUS_POLL_KIND_SOCKET:
            us_internal_afd_update((struct us_internal_afd_req_t *) req);
            break;
        case LIBUS_POLL_KIND_WAITABLE:
            us_internal_waitable_update((struct us_internal_waitable_req_t *) req);
            break;
        default:
            us_internal_pipe_update(req);
            break;
        }
    }
}

static void us_internal_iocp_dispatch_ready_queue(struct us_loop_t *loop) {
    if (!loop->ready_now) {
        loop->ready_now = loop->ready_head;
        loop->ready_head = loop->ready_tail = NULL;
    }
    struct us_internal_poll_req_t *req;
    while ((req = loop->ready_now)) {
        loop->ready_now = req->ready_next;
        req->ready_next = NULL;
        req->is_queued_as_ready = 0;
        if (!req->owner) {
            us_internal_iocp_req_free_if_unused(req);
            continue;
        }
        switch (req->kind) {
        case LIBUS_POLL_KIND_SOCKET:
            us_internal_afd_ready((struct us_internal_afd_req_t *) req);
            break;
        case LIBUS_POLL_KIND_WAITABLE:
            /* Only queued when the kernel has refused its request. */
            us_internal_iocp_dispatch(loop, req->owner, 1, 0, 0);
            break;
        default:
            us_internal_pipe_ready(req);
            break;
        }
    }
}

/* Poll */

_Static_assert(sizeof(struct us_poll_t) == 24 && offsetof(struct us_poll_t, state.kind) == 17, "src/uws_sys/Poll.rs mirrors us_poll_t");

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    if (!fallthrough) {
        loop->num_polls++;
    }
    struct us_poll_t *p = us_xmalloc(sizeof(struct us_poll_t) + ext_size);
    p->state.req = NULL;
    return p;
}

void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
    us_internal_poll_detach(p);
    loop->num_polls--;
    us_free(p);
}

void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type) {
    p->state.fd = fd;
    p->state.req = NULL;
    p->state.poll_type = poll_type;
    p->state.kind = LIBUS_POLL_KIND_SOCKET;
}

void us_internal_poll_set_kind(struct us_poll_t *p, int kind) {
    p->state.kind = kind;
}

__attribute__((always_inline)) int us_poll_events(struct us_poll_t *p) {
    return ((p->state.poll_type & POLL_TYPE_POLLING_IN) ? LIBUS_SOCKET_READABLE : 0) | ((p->state.poll_type & POLL_TYPE_POLLING_OUT) ? LIBUS_SOCKET_WRITABLE : 0);
}

__attribute__((always_inline)) LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) {
    return p->state.fd;
}

int us_internal_poll_type(struct us_poll_t *p) {
    return p->state.poll_type & POLL_TYPE_KIND_MASK;
}

void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
    p->state.poll_type = poll_type | (p->state.poll_type & POLL_TYPE_POLLING_MASK);
    /* What a socket is asked about depends on its type as well. */
    if (p->state.req) {
        us_internal_iocp_queue_update(p->state.req);
    }
}

static void us_internal_poll_set_events(struct us_poll_t *p, int events) {
    p->state.poll_type = us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);
}

struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int old_ext_size, unsigned int ext_size) {
    unsigned int old_size = sizeof(struct us_poll_t) + old_ext_size;
    unsigned int new_size = sizeof(struct us_poll_t) + ext_size;
    if (new_size <= old_size) return p;

    struct us_poll_t *new_p = us_xcalloc(1, new_size);
    memcpy(new_p, p, old_size);

    /* Increment poll count for the new poll - the old poll will be freed separately
     * which decrements the count, keeping the total correct */
    loop->num_polls++;

    if (p->state.req) {
        p->state.req->owner = new_p;
        p->state.req = NULL;
    }
    return new_p;
}

/* On failure the reason is in LIBUS_ERR. */
int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    us_internal_poll_set_events(p, events);

#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_POLL_START, p->state.fd, injected, unused)) return (int) injected;
#endif

    if (!p->state.req) {
        int rc;
        switch (p->state.kind) {
        case LIBUS_POLL_KIND_SOCKET:
            rc = us_internal_afd_start(loop, p);
            break;
        case LIBUS_POLL_KIND_WAITABLE:
            rc = us_internal_waitable_start(loop, p);
            break;
        default:
            rc = us_internal_pipe_start(loop, p);
            break;
        }
        if (rc != 0) {
            return rc;
        }
    }
    p->state.req->hangup_was_reported = 0;
    us_internal_iocp_queue_update(p->state.req);
    return 0;
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    us_poll_start_rc(p, loop, events);
}

int us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    if (us_poll_events(p) == events) {
        return 0;
    }
    struct us_internal_poll_req_t *req = p->state.req;
    if (!req) {
        return us_poll_start_rc(p, loop, events);
    }
    us_internal_poll_set_events(p, events);
    req->hangup_was_reported = 0;
    us_internal_iocp_queue_update(req);
    return 0;
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    us_internal_poll_set_events(p, 0);
    struct us_internal_poll_req_t *req = p->state.req;
    if (!req) {
        return;
    }
    switch (req->kind) {
    case LIBUS_POLL_KIND_SOCKET:
        us_internal_afd_stop((struct us_internal_afd_req_t *) req);
        break;
    case LIBUS_POLL_KIND_WAITABLE:
        us_internal_waitable_stop((struct us_internal_waitable_req_t *) req);
        break;
    default:
        /* The block of a pipe also has the write that is on its way, so the poll keeps it.
         * Not left for the next wait: whoever stops reading stdin may be about to start a child that inherits it. */
        req->hangup_was_reported = 1;
        us_internal_pipe_update(req);
        return;
    }
    req->owner = NULL;
    p->state.req = NULL;
    us_internal_iocp_req_free_if_unused(req);
}

void us_internal_poll_detach(struct us_poll_t *p) {
    struct us_internal_poll_req_t *req = p->state.req;
    if (!req) {
        return;
    }
    if (req->kind >= LIBUS_POLL_KIND_PIPE) {
        us_internal_pipe_detach(req, 0);
    } else {
        us_poll_stop(p, req->loop);
    }
}

void us_internal_poll_close_fd(struct us_poll_t *p) {
    switch (p->state.kind) {
    case LIBUS_POLL_KIND_SOCKET:
        bsd_close_socket(p->state.fd);
        break;
    case LIBUS_POLL_KIND_WAITABLE:
        CloseHandle((HANDLE) p->state.fd);
        break;
    default:
        if (p->state.req) {
            us_internal_pipe_detach(p->state.req, 1);
        } else {
            CloseHandle((HANDLE) p->state.fd);
        }
        break;
    }
}

/* Async (internal helper for loop's wakeup feature) */

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_xcalloc(1, sizeof(struct us_internal_callback_t) + ext_size);
    us_poll_init(&cb->p, LIBUS_SOCKET_ERROR, POLL_TYPE_CALLBACK);
    cb->loop = loop;

    if (!fallthrough) {
        loop->num_polls++;
    }
    return (struct us_internal_async *) cb;
}

void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) a;
    us_poll_free((struct us_poll_t *) a, cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;
}

/* The loop looks at wake_state before it waits and after, so only a loop that said it is about to wait
 * needs a packet to get it out of there. */
void us_internal_async_wakeup(struct us_internal_async *a) {
    struct us_loop_t *loop = ((struct us_internal_callback_t *) a)->loop;
    if (__atomic_exchange_n(&loop->wake_state, LIBUS_WAKE_NOTIFIED, __ATOMIC_ACQ_REL) == LIBUS_WAKE_SLEEPING) {
        if (!PostQueuedCompletionStatus(loop->iocp, 0, LIBUS_IOCP_KEY_WAKE, NULL)) {
            BUN_PANIC("Waking the event loop failed");
        }
    }
}

/* Waking up from sleep
 *
 * Timeouts do not count the time the machine was suspended for, the clock that timers are due by does. So
 * every loop is woken when the machine resumes, to look at that clock again. */

static SRWLOCK us_internal_resume_lock = SRWLOCK_INIT;
static struct us_loop_t *us_internal_resume_loops;

static ULONG CALLBACK us_internal_on_power_event(PVOID context, ULONG type, PVOID setting) {
    if (type == PBT_APMRESUMESUSPEND || type == PBT_APMRESUMEAUTOMATIC) {
        AcquireSRWLockShared(&us_internal_resume_lock);
        for (struct us_loop_t *loop = us_internal_resume_loops; loop; loop = loop->resume_next) {
            us_wakeup_loop(loop);
        }
        ReleaseSRWLockShared(&us_internal_resume_lock);
    }
    return 0;
}

static DWORD WINAPI us_internal_watch_for_resume_thread(void *unused) {
    typedef struct {
        ULONG (CALLBACK *callback)(PVOID context, ULONG type, PVOID setting);
        PVOID context;
    } subscribe_parameters;
    typedef DWORD (WINAPI *register_fn)(DWORD flags, HANDLE recipient, PVOID *registration);

    HMODULE powrprof = LoadLibraryExW(L"powrprof.dll", NULL, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (powrprof) {
        register_fn register_notification = (register_fn) (void *) GetProcAddress(powrprof, "PowerRegisterSuspendResumeNotification");
        if (register_notification) {
            static subscribe_parameters parameters = { us_internal_on_power_event, NULL };
            PVOID registration;
            register_notification(2 /* DEVICE_NOTIFY_CALLBACK */, &parameters, &registration);
        }
    }
    return 0;
}

/* The registration has hung processes at startup (https://github.com/libuv/libuv/issues/1995), so it gets a thread
 * of its own, and only in a process that waits for long enough for any of this to matter. */
static void us_internal_watch_for_resume(void) {
    static int started;
    /* Only picks who starts the thread: nothing is published. */
    if (__atomic_exchange_n(&started, 1, __ATOMIC_RELAXED)) {
        return;
    }
    /* The default stack: loading a library runs code of others. */
    HANDLE thread = CreateThread(NULL, 0, us_internal_watch_for_resume_thread, NULL, 0, NULL);
    if (thread) {
        CloseHandle(thread);
    }
}

/* Loop */

#define LIBUS_NS_PER_MS 1000000ULL
#define LIBUS_100NS_PER_SECOND 10000000
/* What the system clock advances by unless somebody asked for more: 15.625 ms. */
#define LIBUS_CLOCK_TICK_100NS 156250
/* A deadline that moved by less keeps the timer as it is set. */
#define LIBUS_TIMER_SLACK_NS (50 * 1000)

struct us_loop_t *us_create_loop(void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size) {
    struct us_loop_t *loop = (struct us_loop_t *) us_xcalloc(1, sizeof(struct us_loop_t) + ext_size);

    /* One thread takes packets off the port. */
    loop->iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
    if (!loop->iocp) {
        us_free(loop);
        return NULL;
    }

    if (us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb) != 0) {
        CloseHandle(loop->iocp);
        us_free(loop);
        return NULL;
    }

    /* Not on first use: a handle made in the middle of a program gets the value of one the program has just closed. */
    loop->timer = CreateWaitableTimerExW(NULL, NULL, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
    if (loop->timer && NtCreateWaitCompletionPacket(&loop->timer_packet, LIBUS_WAIT_COMPLETION_PACKET_ALL_ACCESS, NULL) != STATUS_SUCCESS) {
        CloseHandle(loop->timer);
        loop->timer = NULL;
        loop->timer_packet = NULL;
    }

    AcquireSRWLockExclusive(&us_internal_resume_lock);
    loop->resume_next = us_internal_resume_loops;
    if (loop->resume_next) {
        loop->resume_next->resume_prev = loop;
    }
    us_internal_resume_loops = loop;
    ReleaseSRWLockExclusive(&us_internal_resume_lock);

    return loop;
}

static void us_internal_iocp_dispatch_ready_polls(struct us_loop_t *loop) {
    while (loop->current_ready_poll < loop->num_ready_polls) {
        /* A copy: a handler can run the loop, which refills ready_polls once it is through with them. */
        const OVERLAPPED_ENTRY entry = loop->ready_polls[loop->current_ready_poll++];
        struct us_internal_iocp_op_t *op = (struct us_internal_iocp_op_t *) entry.lpOverlapped;
        if (op) {
            op->on_complete(loop, op);
        } else if (entry.lpCompletionKey == LIBUS_IOCP_KEY_TIMER) {
            loop->timer_is_associated = 0;
        }
    }
}

/* timeout_100ns: negative to wait for ever. */
static void us_internal_iocp_fetch_ready_polls(struct us_loop_t *loop, ULONG max, int64_t timeout_100ns) {
    DWORD timeout_ms = INFINITE;
    if (timeout_100ns >= 0) {
        const int64_t rounded_up = (timeout_100ns + LIBUS_100NS_PER_MS - 1) / LIBUS_100NS_PER_MS;
        timeout_ms = rounded_up < INFINITE ? (DWORD) rounded_up : INFINITE - 1;
    }
    ULONG count = 0;
    /* The count means nothing after a failure. */
    if (!GetQueuedCompletionStatusEx(loop->iocp, loop->ready_polls, max, &count, timeout_ms, FALSE)) {
        if (GetLastError() != WAIT_TIMEOUT) {
            BUN_PANIC("Waiting on the event loop's completion port failed");
        }
        count = 0;
    }
    loop->num_ready_polls = (int) count;
    loop->current_ready_poll = 0;
}

/* Long enough for a thread that sleeps to wake up and do a short piece of work. */
#define LIBUS_POLL_NS 20000
/* A wait that was over this soon, waking up included, would have been over within LIBUS_POLL_NS without the sleep. */
#define LIBUS_SHORT_WAIT_NS 30000

/* Instead of sleeping at once, asks for LIBUS_POLL_NS whether a packet or a wake-up has come: an answer from another
 * thread or process that is on its way is there sooner than this thread would be awake again. Each time nothing
 * comes, twice as many waits go without. Returns whether there is something, with the packets fetched. */
static int us_internal_iocp_poll(struct us_loop_t *loop, uint64_t start_ns) {
    if (loop->polls_to_skip) {
        loop->polls_to_skip--;
        return 0;
    }
    do {
        if (__atomic_load_n(&loop->wake_state, __ATOMIC_RELAXED) != LIBUS_WAKE_NOTIFIED) {
            us_internal_iocp_fetch_ready_polls(loop, LIBUS_FIRST_READY_POLLS, 0);
            if (loop->num_ready_polls == 0) {
                YieldProcessor();
                continue;
            }
        }
        loop->polls_skipped_last = 0;
        return 1;
    } while (us_internal_monotonic_ns() - start_ns < LIBUS_POLL_NS);
    loop->polls_skipped_last = loop->polls_skipped_last < 127 ? loop->polls_skipped_last * 2 + 1 : 255;
    loop->polls_to_skip = loop->polls_skipped_last;
    return 0;
}

void us_loop_free(struct us_loop_t *loop) {
    AcquireSRWLockExclusive(&us_internal_resume_lock);
    if (loop->resume_prev) {
        loop->resume_prev->resume_next = loop->resume_next;
    } else {
        us_internal_resume_loops = loop->resume_next;
    }
    if (loop->resume_next) {
        loop->resume_next->resume_prev = loop->resume_prev;
    }
    ReleaseSRWLockExclusive(&us_internal_resume_lock);

    us_internal_loop_data_free(loop);

    /* Nothing is cancelled because its thread or its port goes away, and the kernel writes into a
     * block when the block's packet is taken off the port. So take every block away from its poll, cancel
     * what it has in flight, and collect the packets. */
    for (struct us_internal_poll_req_t *req = loop->reqs, *next; req; req = next) {
        next = req->next;
        if (req->kind >= LIBUS_POLL_KIND_PIPE) {
            us_internal_pipe_abandon(req);
        } else if (req->owner) {
            us_internal_poll_detach(req->owner);
        }
    }
    us_internal_iocp_flush_updates(loop);
    /* Once for what a nested tick left of its round, once for what waits for the next. */
    us_internal_iocp_dispatch_ready_queue(loop);
    us_internal_iocp_dispatch_ready_queue(loop);
    us_internal_iocp_dispatch_ready_polls(loop);
    const uint64_t deadline_ns = us_internal_monotonic_ns() + 10000 * LIBUS_NS_PER_MS;
    while (loop->num_inflight_ops && us_internal_monotonic_ns() < deadline_ns) {
        us_internal_iocp_fetch_ready_polls(loop, LIBUS_MAX_READY_POLLS, 100 * LIBUS_100NS_PER_MS);
        us_internal_iocp_dispatch_ready_polls(loop);
    }

    for (struct us_internal_afd_group_t *group = loop->afd_groups, *next; group; group = next) {
        next = group->next;
        CloseHandle(group->helper);
        us_free(group);
    }
    if (loop->timer_packet) CloseHandle(loop->timer_packet);
    if (loop->timer) CloseHandle(loop->timer);
    if (loop->scratch_event) CloseHandle(loop->scratch_event);
    CloseHandle(loop->iocp);

    /* A driver that sits on a cancelled request still has pointers into its block, and the block into the loop. */
    if (!loop->num_inflight_ops) {
        us_free(loop);
    }
}

static int us_internal_iocp_arm_timer(struct us_loop_t *loop, int64_t timeout_100ns) {
    if (!loop->timer) {
        return 0;
    }

    /* Most ticks wait for the same timer as the tick before. */
    const uint64_t deadline_ns = us_internal_monotonic_ns() + (uint64_t) timeout_100ns * 100;
    if (loop->timer_is_associated) {
        const uint64_t moved_by_ns = deadline_ns > loop->timer_deadline_ns ? deadline_ns - loop->timer_deadline_ns : loop->timer_deadline_ns - deadline_ns;
        if (moved_by_ns < LIBUS_TIMER_SLACK_NS) {
            return 1;
        }
    }

    /* Setting a timer that the packet is waiting on moves the expiry. If it has expired already, its packet is on
     * the port and ends the coming wait early, which the caller has to be prepared for in any case. */
    LARGE_INTEGER due;
    due.QuadPart = -timeout_100ns;
    if (!SetWaitableTimer(loop->timer, &due, 0, NULL, NULL, FALSE)) {
        return 0;
    }
    loop->timer_deadline_ns = deadline_ns;
    if (!loop->timer_is_associated) {
        if (NtAssociateWaitCompletionPacket(loop->timer_packet, loop->iocp, loop->timer, (PVOID) LIBUS_IOCP_KEY_TIMER, NULL, STATUS_SUCCESS, 0, NULL) != STATUS_SUCCESS) {
            return 0;
        }
        loop->timer_is_associated = 1;
    }
    return 1;
}

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec *timeout, uint64_t now_ns) {
    if (loop->num_polls == 0)
        return;

    loop->data.tick_depth++;

    /* Emit pre callback */
    us_internal_loop_pre(loop);

    struct timespec timeout_storage;
    timeout = us_internal_loop_bound_timeout(loop, timeout, &timeout_storage);

    us_internal_iocp_flush_updates(loop);

    /* Rounded up: rounding down turns the last fraction of a wait into a busy loop. */
    int64_t timeout_100ns = -1;
    if (timeout) {
        const int64_t max_seconds = 1000000000;
        timeout_100ns = (timeout->tv_sec > max_seconds ? max_seconds : (int64_t) timeout->tv_sec) * LIBUS_100NS_PER_SECOND + ((int64_t) timeout->tv_nsec + 99) / 100;
        /* A deadline that has passed gives a negative timeout. */
        if (timeout_100ns < 0) {
            timeout_100ns = 0;
        }
    }
    /* This tick was started by a handler of a tick that has packets left. They are gone from the port, so they are this tick's. */
    const int has_ready_polls = loop->current_ready_poll < loop->num_ready_polls;
    if (has_ready_polls || loop->ready_head || loop->ready_now) {
        timeout_100ns = 0;
    }
    const uint64_t wait_start_ns = timeout_100ns != 0 ? us_internal_monotonic_ns() : 0;
    if (wait_start_ns && loop->last_wait_was_short && us_internal_iocp_poll(loop, wait_start_ns)) {
        timeout_100ns = 0;
    }
    if (timeout_100ns != 0) {
        unsigned int expected = LIBUS_WAKE_AWAKE;
        if (!__atomic_compare_exchange_n(&loop->wake_state, &expected, LIBUS_WAKE_SLEEPING, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
            timeout_100ns = 0;
        }
    }
    const int will_idle_inside_event_loop = timeout_100ns != 0;

    if (timeout_100ns > 0) {
        if (timeout_100ns >= LIBUS_100NS_PER_SECOND) {
            us_internal_watch_for_resume();
        }
        /* With the timer armed, the timeout of the wait itself is only there in case the timer fails. */
        if (us_internal_iocp_arm_timer(loop, timeout_100ns)) {
            timeout_100ns += LIBUS_CLOCK_TICK_100NS;
        }
    }

    struct us_internal_wait_t wait_state;
    if (will_idle_inside_event_loop)
        us_internal_loop_before_wait(loop, now_ns, &wait_state);

    /* Fetch ready polls, unless there are some left or us_internal_iocp_poll() did. */
    if (loop->current_ready_poll == loop->num_ready_polls) {
        us_internal_iocp_fetch_ready_polls(loop, LIBUS_FIRST_READY_POLLS, timeout_100ns);
    }
    if (wait_start_ns) {
        loop->last_wait_was_short = us_internal_monotonic_ns() - wait_start_ns < LIBUS_SHORT_WAIT_NS;
    }

    if (will_idle_inside_event_loop)
        us_internal_loop_after_wait(loop, &wait_state);

    if (__atomic_exchange_n(&loop->wake_state, LIBUS_WAKE_AWAKE, __ATOMIC_ACQ_REL) == LIBUS_WAKE_NOTIFIED) {
        us_internal_dispatch_ready_poll((struct us_poll_t *) loop->data.wakeup_async, 0, 0, LIBUS_SOCKET_READABLE);
    }

    /* What was found ready without asking the port was ready before the wait. It goes first, as what epoll reports
     * once more because it was not read to the end: the last a child wrote is read before its exit is seen. */
    us_internal_iocp_dispatch_ready_queue(loop);

    ULONG max_ready_polls = LIBUS_FIRST_READY_POLLS;
    int drain_count = 48;
    for (;;) {
        const int was_full = !has_ready_polls && loop->num_ready_polls == (int) max_ready_polls;
        us_internal_iocp_dispatch_ready_polls(loop);
        /* If the kernel filled our entire buffer, more packets are likely already queued: see
         * us_internal_drain_ready_polls in epoll_kqueue.c. */
        if (LIKELY(!was_full) || --drain_count == 0 || loop->num_polls <= 0) {
            break;
        }
        max_ready_polls = LIBUS_MAX_READY_POLLS;
        us_internal_iocp_fetch_ready_polls(loop, max_ready_polls, 0);
    }
    if (loop->has_resent_polls) {
        loop->has_resent_polls = 0;
        if (loop->num_polls > 0) {
            us_internal_iocp_fetch_ready_polls(loop, LIBUS_MAX_READY_POLLS, 0);
            us_internal_iocp_dispatch_ready_polls(loop);
            /* One more round is all a tick gives them. */
            loop->has_resent_polls = 0;
        }
    }
    us_internal_sweep_if_due(loop);

    /* Emit post callback */
    us_internal_loop_post(loop);
    loop->data.tick_depth--;
}

int us_socket_get_error(struct us_socket_t *s) {
    if (us_internal_poll_is_pipe(&s->p)) {
        return us_internal_pipe_error(&s->p);
    }
    int error = 0;
    socklen_t len = sizeof(error);
    if (getsockopt(us_poll_fd((struct us_poll_t *) s), SOL_SOCKET, SO_ERROR, (char *) &error, &len) == SOCKET_ERROR) {
        return WSAGetLastError();
    }
    return error;
}

#endif
