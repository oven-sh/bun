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

#include "libusockets.h"
#include "internal/internal.h"
#include "internal/fault_inject.h"

#ifdef LIBUS_USE_IOCP

#include <limits.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <winternl.h>
#include <mswsock.h>
#include <mimalloc.h>

/* Socket readiness on Windows comes from the AFD driver: an IOCTL_AFD_POLL
 * issued on a \Device\Afd handle that is associated with the loop's completion
 * port completes when one of the requested conditions holds for the socket.
 * A poll is one-shot and level-triggered (a condition that already holds
 * completes it at once), so interest is kept armed by submitting again after
 * each completion. This is the mechanism behind wepoll, mio, c-ares and
 * libuv's uv_poll_t. */

extern void Bun__JSC_onBeforeWait(void *_Nonnull jsc_vm);

#ifndef STATUS_SUCCESS
#define STATUS_SUCCESS ((NTSTATUS) 0x00000000L)
#endif
#ifndef STATUS_PENDING
#define STATUS_PENDING ((NTSTATUS) 0x00000103L)
#endif
#ifndef STATUS_CANCELLED
#define STATUS_CANCELLED ((NTSTATUS) 0xC0000120L)
#endif
#ifndef STATUS_INVALID_HANDLE
#define STATUS_INVALID_HANDLE ((NTSTATUS) 0xC0000008L)
#endif
#ifndef NT_SUCCESS
#define NT_SUCCESS(status) (((NTSTATUS) (status)) >= 0)
#endif

#define IOCTL_AFD_POLL 0x00012024

#define AFD_POLL_RECEIVE 0x0001
#define AFD_POLL_RECEIVE_EXPEDITED 0x0002
#define AFD_POLL_SEND 0x0004
#define AFD_POLL_DISCONNECT 0x0008
#define AFD_POLL_ABORT 0x0010
#define AFD_POLL_LOCAL_CLOSE 0x0020
/* AFD_POLL_CONNECT (0x0040) is never requested: it makes every poll of a
 * connected socket complete immediately. */
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

/* NtCancelIoFileEx walks the requests outstanding on the file object, so its
 * cost grows with their number; spreading sockets over several \Device\Afd
 * handles keeps it flat (measured: ~2us at 128 per handle, 65-125us with 8192
 * on one). */
#define AFD_POLLS_PER_HELPER 128

/* Completion key of the wait timer's packet; every other packet has key 0. */
#define HRTIMER_COMPLETION_KEY ((ULONG_PTR) 1)

struct us_internal_afd_helper {
    HANDLE handle;
    unsigned int count;
    struct us_internal_afd_helper *next;
};

enum {
    AFD_POLL_STATE_IDLE = 0,
    /* A poll is outstanding. */
    AFD_POLL_STATE_PENDING,
    /* A poll is outstanding and a cancel was requested for it. */
    AFD_POLL_STATE_CANCELLED,
};

/* The kernel writes `iosb` and `info` when the completion packet is dequeued,
 * so this is freed only from its own completion (or while no poll is
 * outstanding), never when the owner goes away. */
struct us_internal_afd_poll {
    struct us_iocp_op op;
    IO_STATUS_BLOCK iosb;
    AFD_POLL_INFO info;
    /* us_poll_t*, a Bun-tagged pointer, or NULL once the owner stopped polling. */
    void *owner;
    struct us_loop_t *loop;
    struct us_internal_afd_helper *helper;
    SOCKET socket;
    SOCKET base_socket;
    struct us_internal_afd_poll *update_next;
    /* LIBUS_SOCKET_* the owner wants. */
    int interest;
    /* AFD_POLL_* of the outstanding poll. */
    ULONG pending_events;
    unsigned char state;
    unsigned char queued_for_update;
    /* DISCONNECT and ABORT stay signalled once raised. A poll that is not
     * reading leaves one out of its mask after reporting it, until the owner
     * changes its interest. */
    unsigned char reported_disconnect;
    unsigned char reported_abort;
    /* The socket's provider is not AFD (a non-IFS LSP without a base handle):
     * readiness comes from select() on a thread-pool thread instead, and
     * `state` stays idle. A select() cannot be interrupted, so when the
     * interest changes a second one runs alongside the first. */
    unsigned char slow;
    unsigned char slow_requests;
    int slow_submitted_interest;
};

struct us_internal_slow_poll_req {
    struct us_iocp_op op;
    struct us_internal_afd_poll *poll;
    /* The thread's own handle to the port: select() can return after the loop was freed. */
    HANDLE port;
    SOCKET socket;
    int interest;
    int result_events;
    int result_error;
};

typedef NTSTATUS(NTAPI *nt_create_file_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
typedef NTSTATUS(NTAPI *nt_device_io_control_file_fn)(HANDLE, HANDLE, PVOID, PVOID, PIO_STATUS_BLOCK, ULONG, PVOID, ULONG, PVOID, ULONG);
typedef NTSTATUS(NTAPI *nt_cancel_io_file_ex_fn)(HANDLE, PIO_STATUS_BLOCK, PIO_STATUS_BLOCK);
typedef NTSTATUS(NTAPI *nt_create_wait_completion_packet_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES);
typedef NTSTATUS(NTAPI *nt_associate_wait_completion_packet_fn)(HANDLE, HANDLE, HANDLE, PVOID, PVOID, NTSTATUS, ULONG_PTR, PBOOLEAN);
typedef NTSTATUS(NTAPI *nt_cancel_wait_completion_packet_fn)(HANDLE, BOOLEAN);

static INIT_ONCE nt_once = INIT_ONCE_STATIC_INIT;
static nt_create_file_fn pNtCreateFile;
static nt_device_io_control_file_fn pNtDeviceIoControlFile;
static nt_cancel_io_file_ex_fn pNtCancelIoFileEx;
/* Absent under Wine; the callers fall back. */
static nt_create_wait_completion_packet_fn pNtCreateWaitCompletionPacket;
static nt_associate_wait_completion_packet_fn pNtAssociateWaitCompletionPacket;
static nt_cancel_wait_completion_packet_fn pNtCancelWaitCompletionPacket;
static uint64_t qpc_frequency;

static BOOL CALLBACK nt_init(PINIT_ONCE once, PVOID param, PVOID *context) {
    (void) once;
    (void) param;
    (void) context;
    HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    pNtCreateFile = (nt_create_file_fn) (void *) GetProcAddress(ntdll, "NtCreateFile");
    pNtDeviceIoControlFile = (nt_device_io_control_file_fn) (void *) GetProcAddress(ntdll, "NtDeviceIoControlFile");
    pNtCancelIoFileEx = (nt_cancel_io_file_ex_fn) (void *) GetProcAddress(ntdll, "NtCancelIoFileEx");
    pNtCreateWaitCompletionPacket = (nt_create_wait_completion_packet_fn) (void *) GetProcAddress(ntdll, "NtCreateWaitCompletionPacket");
    pNtAssociateWaitCompletionPacket = (nt_associate_wait_completion_packet_fn) (void *) GetProcAddress(ntdll, "NtAssociateWaitCompletionPacket");
    pNtCancelWaitCompletionPacket = (nt_cancel_wait_completion_packet_fn) (void *) GetProcAddress(ntdll, "NtCancelWaitCompletionPacket");
    if (!pNtCreateWaitCompletionPacket || !pNtAssociateWaitCompletionPacket || !pNtCancelWaitCompletionPacket) {
        pNtCreateWaitCompletionPacket = NULL;
    }
    LARGE_INTEGER frequency;
    QueryPerformanceFrequency(&frequency);
    qpc_frequency = (uint64_t) frequency.QuadPart;
    return pNtCreateFile && pNtDeviceIoControlFile && pNtCancelIoFileEx;
}

static int nt_ensure(void) {
    return InitOnceExecuteOnce(&nt_once, nt_init, NULL, NULL) != 0;
}

uint64_t us_internal_monotonic_ns(void) {
    nt_ensure();
    LARGE_INTEGER counter;
    QueryPerformanceCounter(&counter);
    uint64_t ticks = (uint64_t) counter.QuadPart;
    return (ticks / qpc_frequency) * 1000000000ULL + ((ticks % qpc_frequency) * 1000000000ULL) / qpc_frequency;
}

HANDLE us_loop_iocp(struct us_loop_t *loop) {
    return loop->iocp;
}

void us_iocp_op_submitted(struct us_loop_t *loop) {
    InterlockedIncrement((volatile LONG *) &loop->pending_ops);
}

void us_iocp_op_ready(struct us_loop_t *loop, struct us_iocp_op *op) {
    op->next_ready = NULL;
    if (loop->ready_ops_tail) {
        loop->ready_ops_tail->next_ready = op;
    } else {
        loop->ready_ops_head = op;
    }
    loop->ready_ops_tail = op;
    loop->num_ready_ops++;
}

/* AFD helper handles */

static struct us_internal_afd_helper *afd_helper_acquire(struct us_loop_t *loop) {
    for (struct us_internal_afd_helper *h = loop->afd_helpers; h; h = h->next) {
        if (h->count < AFD_POLLS_PER_HELPER) {
            h->count++;
            return h;
        }
    }

    /* Any name under \Device\Afd opens the driver; the suffix only shows up in handle listings. */
    static const WCHAR name[] = L"\\Device\\Afd\\Bun";
    UNICODE_STRING device_name;
    device_name.Buffer = (PWSTR) name;
    device_name.Length = sizeof(name) - sizeof(WCHAR);
    device_name.MaximumLength = sizeof(name);
    OBJECT_ATTRIBUTES attributes;
    InitializeObjectAttributes(&attributes, &device_name, 0, NULL, NULL);

    HANDLE handle = NULL;
    IO_STATUS_BLOCK iosb;
    NTSTATUS status = pNtCreateFile(&handle, SYNCHRONIZE, &attributes, &iosb, NULL, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN, 0, NULL, 0);
    if (!NT_SUCCESS(status)) {
        return NULL;
    }
    if (CreateIoCompletionPort(handle, loop->iocp, 0, 0) == NULL) {
        CloseHandle(handle);
        return NULL;
    }

    struct us_internal_afd_helper *h = us_calloc(1, sizeof(struct us_internal_afd_helper));
    h->handle = handle;
    h->count = 1;
    h->next = loop->afd_helpers;
    loop->afd_helpers = h;
    return h;
}

/* The socket AFD knows about. A layered service provider hands out its own
 * handle; SIO_BASE_HANDLE unwraps it, and SIO_BSP_HANDLE_POLL peels one layer
 * for providers that intercept SIO_BASE_HANDLE. INVALID_SOCKET if the chain
 * does not end at an AFD socket; `*not_a_socket` when the handle is no socket
 * at all, which is an error rather than a case for the select() fallback. */
static SOCKET afd_base_socket(SOCKET socket, int *not_a_socket) {
    *not_a_socket = 0;
    for (int depth = 0; depth < 8; depth++) {
        SOCKET base = INVALID_SOCKET;
        DWORD bytes;
        if (WSAIoctl(socket, SIO_BASE_HANDLE, NULL, 0, &base, sizeof(base), &bytes, NULL, NULL) != SOCKET_ERROR) {
            return base;
        }
        if (WSAGetLastError() == WSAENOTSOCK) {
            *not_a_socket = depth == 0;
            return INVALID_SOCKET;
        }
        if (WSAIoctl(socket, SIO_BSP_HANDLE_POLL, NULL, 0, &base, sizeof(base), &bytes, NULL, NULL) == SOCKET_ERROR || base == socket) {
            return INVALID_SOCKET;
        }
        socket = base;
    }
    return INVALID_SOCKET;
}

static void afd_poll_free(struct us_internal_afd_poll *poll) {
    if (poll->helper) {
        poll->helper->count--;
    }
    us_free(poll);
}

static void afd_poll_queue_update(struct us_internal_afd_poll *poll) {
    if (poll->queued_for_update) {
        return;
    }
    poll->queued_for_update = 1;
    poll->update_next = NULL;
    if (poll->loop->afd_update_tail) {
        poll->loop->afd_update_tail->update_next = poll;
    } else {
        poll->loop->afd_update_head = poll;
    }
    poll->loop->afd_update_tail = poll;
}

static int afd_poll_owner_kind(struct us_internal_afd_poll *poll) {
    if (CLEAR_POINTER_TAG(poll->owner) != poll->owner) {
        return -1;
    }
    return us_internal_poll_type((struct us_poll_t *) poll->owner);
}

static ULONG afd_poll_wanted_events(struct us_internal_afd_poll *poll) {
    ULONG events = AFD_POLL_LOCAL_CLOSE;
    if (poll->interest & LIBUS_SOCKET_READABLE) {
        /* RECEIVE reports neither the peer's FIN nor its RST. A reader is told
         * about both as readable for as long as they hold, so that recv()
         * finds the end of the stream after whatever data came with it. */
        return events | AFD_POLL_RECEIVE | AFD_POLL_ACCEPT | AFD_POLL_DISCONNECT | AFD_POLL_ABORT |
            ((poll->interest & LIBUS_SOCKET_WRITABLE) ? AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL : 0);
    }
    if (poll->interest & LIBUS_SOCKET_WRITABLE) {
        events |= AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL;
    }
    /* Not reading (paused, half-open, connecting): still asked for, which is
     * what epoll reports unasked as EPOLLHUP/EPOLLERR, but only until it has
     * been reported once: both stay signalled, and nothing here consumes them. */
    if (!poll->reported_disconnect) {
        events |= AFD_POLL_DISCONNECT;
    }
    if (!poll->reported_abort) {
        events |= AFD_POLL_ABORT;
    }
    return events;
}

static void afd_poll_complete(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry);
static int slow_poll_submit(struct us_internal_afd_poll *poll);
static void us_internal_resume_list_add(struct us_loop_t *loop);
static void us_internal_resume_list_remove(struct us_loop_t *loop);
static void acceptors_cancel(struct us_loop_t *loop);
static void acceptors_retry_starved(struct us_loop_t *loop);

/* 0, or -1 with the Winsock error set when the kernel refused the poll (no packet follows). */
static int afd_poll_submit(struct us_internal_afd_poll *poll) {
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_POLL_START, poll->socket, injected, unused)) {
        return -1;
    }
#endif
    if (poll->slow) {
        return slow_poll_submit(poll);
    }

    ULONG events = afd_poll_wanted_events(poll);
    poll->info.Timeout.QuadPart = INT64_MAX;
    poll->info.NumberOfHandles = 1;
    poll->info.Exclusive = FALSE;
    poll->info.Handles[0].Handle = (HANDLE) poll->base_socket;
    poll->info.Handles[0].Events = events;
    poll->info.Handles[0].Status = 0;
    poll->iosb.Status = STATUS_PENDING;

    NTSTATUS status = pNtDeviceIoControlFile(poll->helper->handle, NULL, NULL, &poll->op, &poll->iosb, IOCTL_AFD_POLL, &poll->info, sizeof(poll->info), &poll->info, sizeof(poll->info));
    if (status != STATUS_PENDING && !NT_SUCCESS(status)) {
        WSASetLastError(status == STATUS_INVALID_HANDLE ? WSAENOTSOCK : WSAENOBUFS);
        return -1;
    }
    /* A poll that completed synchronously still queues its packet. */
    poll->state = AFD_POLL_STATE_PENDING;
    poll->pending_events = events;
    us_iocp_op_submitted(poll->loop);
    return 0;
}

static void afd_poll_cancel(struct us_internal_afd_poll *poll) {
    if (poll->state != AFD_POLL_STATE_PENDING || poll->slow) {
        return;
    }
    poll->state = AFD_POLL_STATE_CANCELLED;
    /* The result says nothing reliable: the poll can still complete normally
     * after a successful cancel, and STATUS_NOT_FOUND means its packet is
     * already queued. Either way exactly one packet arrives. */
    IO_STATUS_BLOCK cancel_iosb;
    pNtCancelIoFileEx(poll->helper->handle, &poll->iosb, &cancel_iosb);
}

static void afd_poll_set_interest(struct us_internal_afd_poll *poll, int interest) {
    poll->interest = interest;
    poll->reported_disconnect = 0;
    poll->reported_abort = 0;
    if (poll->slow || poll->state == AFD_POLL_STATE_IDLE) {
        afd_poll_queue_update(poll);
    } else if (poll->state == AFD_POLL_STATE_PENDING && (afd_poll_wanted_events(poll) & ~poll->pending_events)) {
        /* An outstanding poll cannot be modified, and a second one on the same
         * socket from this thread would steal its events: cancel it and
         * submit the wider mask from its completion. */
        afd_poll_cancel(poll);
    }
}

static struct us_internal_afd_poll *afd_poll_create(struct us_loop_t *loop, void *owner, SOCKET socket, int interest) {
    if (!nt_ensure()) {
        WSASetLastError(WSASYSNOTREADY);
        return NULL;
    }

    struct us_internal_afd_poll *poll = us_calloc(1, sizeof(struct us_internal_afd_poll));
    poll->op.complete = afd_poll_complete;
    poll->owner = owner;
    poll->loop = loop;
    poll->socket = socket;
    poll->interest = interest;
    int not_a_socket;
    poll->base_socket = afd_base_socket(socket, &not_a_socket);

    if (not_a_socket) {
        us_free(poll);
        WSASetLastError(WSAENOTSOCK);
        return NULL;
    }
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_POLL_SLOW, socket, injected, unused)) {
        poll->base_socket = INVALID_SOCKET;
    }
#endif
    if (poll->base_socket == INVALID_SOCKET) {
        poll->slow = 1;
    } else {
        poll->helper = afd_helper_acquire(loop);
        if (!poll->helper) {
            us_free(poll);
            WSASetLastError(WSAEMFILE);
            return NULL;
        }
    }

    if (afd_poll_submit(poll) != 0) {
        int err = WSAGetLastError();
        afd_poll_free(poll);
        WSASetLastError(err);
        return NULL;
    }
    return poll;
}

static void afd_poll_stop(struct us_internal_afd_poll *poll) {
    poll->owner = NULL;
    if (poll->state != AFD_POLL_STATE_IDLE || poll->slow_requests) {
        afd_poll_cancel(poll);
        return;
    }
    if (!poll->queued_for_update) {
        afd_poll_free(poll);
    }
}

static void afd_poll_dispatch(struct us_loop_t *loop, struct us_internal_afd_poll *poll, int error, int eof, int events) {
    events &= poll->interest;
    if ((!events && !error && !eof) || loop->closing) {
        return;
    }
    if (CLEAR_POINTER_TAG(poll->owner) != poll->owner) {
        loop->current_ready_events = events;
        loop->current_ready_error = error;
        loop->current_ready_eof = eof;
        Bun__internal_dispatch_ready_poll(loop, poll->owner);
        return;
    }
    us_internal_dispatch_ready_poll((struct us_poll_t *) poll->owner, error, eof, events);
}

/* Windows does not reliably latch a received RST in SO_ERROR (POSIX does);
 * the reset surfaces on the next I/O. A zero-byte send observes it without
 * touching the stream: 0 on a healthy socket, SOCKET_ERROR with a fatal
 * code once the connection died hard. */
int us_internal_peer_reset_probe(LIBUS_SOCKET_DESCRIPTOR fd) {
    if (send(fd, "", 0, 0) != SOCKET_ERROR) {
        return 0;
    }
    int err = WSAGetLastError();
    /* WSAESHUTDOWN means our own shutdown(SD_SEND) ran; that is not a peer reset. */
    return err != WSAEWOULDBLOCK && err != WSAESHUTDOWN;
}

static void afd_poll_report(struct us_loop_t *loop, struct us_internal_afd_poll *poll, ULONG afd_events) {
    int events = 0;
    int error = 0;
    int eof = 0;

    if (afd_events & (AFD_POLL_RECEIVE | AFD_POLL_ACCEPT)) {
        events |= LIBUS_SOCKET_READABLE;
    }
    if (afd_events & (AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL)) {
        events |= LIBUS_SOCKET_WRITABLE;
    }
    /* What epoll reports as EPOLLERR: the connecting path reads the cause from SO_ERROR. */
    if (afd_events & AFD_POLL_CONNECT_FAIL) {
        error = 1;
    }

    if (afd_events & (AFD_POLL_DISCONNECT | AFD_POLL_ABORT)) {
        if (afd_events & AFD_POLL_DISCONNECT) poll->reported_disconnect = 1;
        if (afd_events & AFD_POLL_ABORT) poll->reported_abort = 1;

        int kind = afd_poll_owner_kind(poll);
        int reading = poll->interest & LIBUS_SOCKET_READABLE;
        if (kind == POLL_TYPE_SOCKET_SHUT_DOWN) {
            /* With our write side shut down no readable event follows the
             * peer's FIN, and no data-bearing flow is left that an early EOF
             * could truncate. Everywhere else recv() owns EOF discovery,
             * because DISCONNECT can be raised while data is still queued. */
            eof = LIBUS_POLL_EOF;
            events |= reading;
        } else if (kind == POLL_TYPE_SOCKET && !reading) {
            /* Paused, or half-open with its end already delivered. Reading
             * here would pull bytes a paused caller deferred, or rediscover
             * the same EOF. A reset closes the socket through the error path;
             * a FIN waits for resume(), whose interest change asks for
             * DISCONNECT again. */
            struct us_socket_t *s = us_internal_socket_follow_adopted((struct us_socket_t *) poll->owner);
            if (!s->flags.is_closed && ((afd_events & AFD_POLL_ABORT) || us_socket_get_error(s) != 0 || us_internal_peer_reset_probe(poll->socket))) {
                error = 1;
            }
        } else if (kind == -1 && !reading) {
            /* What epoll tells a Bun-owned poll unasked as EPOLLERR/EPOLLHUP. */
            error = (afd_events & AFD_POLL_ABORT) != 0;
            eof = (afd_events & AFD_POLL_DISCONNECT) != 0;
        } else {
            /* recv()/accept() reports what happened. */
            events |= LIBUS_SOCKET_READABLE;
        }
    }

    afd_poll_dispatch(loop, poll, error, eof, events);
}

static void afd_poll_complete(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry) {
    (void) entry;
    struct us_internal_afd_poll *poll = (struct us_internal_afd_poll *) op;
    poll->state = AFD_POLL_STATE_IDLE;

    if (!poll->owner) {
        afd_poll_free(poll);
        return;
    }

    NTSTATUS status = poll->iosb.Status;
    if (status == STATUS_CANCELLED) {
        afd_poll_queue_update(poll);
        loop->afd_saw_cancelled = 1;
        return;
    }
    if (!NT_SUCCESS(status)) {
        afd_poll_dispatch(loop, poll, 1, 0, 0);
        return;
    }

    ULONG afd_events = poll->info.NumberOfHandles >= 1 ? poll->info.Handles[0].Events : 0;
    if (afd_events & AFD_POLL_LOCAL_CLOSE) {
        /* The socket was closed without stopping its poll first. Nothing is left to report or re-arm. */
        return;
    }

    /* Re-armed by the flush before the next wait, after the callbacks of this
     * batch ran: arming before the owner consumes the data completes again at
     * once for the same data. */
    afd_poll_queue_update(poll);
    afd_poll_report(loop, poll, afd_events);
}

static void afd_flush_updates(struct us_loop_t *loop) {
    while (loop->afd_update_head) {
        struct us_internal_afd_poll *poll = loop->afd_update_head;
        loop->afd_update_head = poll->update_next;
        if (!loop->afd_update_head) {
            loop->afd_update_tail = NULL;
        }
        poll->update_next = NULL;
        poll->queued_for_update = 0;

        if (!poll->owner) {
            if (poll->state == AFD_POLL_STATE_IDLE && !poll->slow_requests) {
                afd_poll_free(poll);
            }
            continue;
        }
        if (poll->state != AFD_POLL_STATE_IDLE || loop->closing) {
            continue;
        }
        if (poll->slow && poll->slow_requests && poll->slow_submitted_interest == poll->interest) {
            continue;
        }
        if (afd_poll_submit(poll) != 0) {
            afd_poll_dispatch(loop, poll, 1, 0, 0);
        }
    }
}

/* select() fallback for sockets whose provider chain does not end at AFD. */

static void slow_poll_complete(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry) {
    (void) entry;
    struct us_internal_slow_poll_req *req = (struct us_internal_slow_poll_req *) op;
    struct us_internal_afd_poll *poll = req->poll;
    int events = req->result_events;
    int error = req->result_error;
    int stale = req->interest != poll->interest;
    us_free(req);

    poll->slow_requests--;
    if (!poll->owner) {
        if (!poll->slow_requests && !poll->queued_for_update) {
            afd_poll_free(poll);
        }
        return;
    }
    afd_poll_queue_update(poll);
    if (!stale || error) {
        afd_poll_dispatch(loop, poll, error, 0, events);
    }
}

static DWORD WINAPI slow_poll_thread(LPVOID param) {
    struct us_internal_slow_poll_req *req = param;
    fd_set rfds, wfds, efds;
    FD_ZERO(&rfds);
    FD_ZERO(&wfds);
    FD_ZERO(&efds);
    if (req->interest & LIBUS_SOCKET_READABLE) {
        FD_SET(req->socket, &rfds);
    }
    if (req->interest & LIBUS_SOCKET_WRITABLE) {
        FD_SET(req->socket, &wfds);
        FD_SET(req->socket, &efds);
    }
    /* Bounded so a request whose interest went away is eventually reclaimed; closing the socket ends it at once. */
    struct timeval timeout = {.tv_sec = 3 * 60, .tv_usec = 0};
    int rc = select(0, &rfds, &wfds, &efds, &timeout);
    if (rc == SOCKET_ERROR) {
        req->result_error = 1;
    } else if (rc > 0) {
        if (FD_ISSET(req->socket, &rfds)) req->result_events |= LIBUS_SOCKET_READABLE;
        if (FD_ISSET(req->socket, &wfds) || FD_ISSET(req->socket, &efds)) req->result_events |= LIBUS_SOCKET_WRITABLE;
    }
    /* The completion frees `req`. */
    HANDLE port = req->port;
    PostQueuedCompletionStatus(port, 0, 0, &req->op.overlapped);
    CloseHandle(port);
    return 0;
}

static int slow_poll_submit(struct us_internal_afd_poll *poll) {
    /* select() reports nothing but readable and writable, and fails at once
     * when given no socket at all. A change of interest submits again. */
    if (!(poll->interest & (LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE))) {
        return 0;
    }
    /* Retried from the next completion. */
    if (poll->slow_requests >= 2) {
        return 0;
    }
    struct us_internal_slow_poll_req *req = us_calloc(1, sizeof(struct us_internal_slow_poll_req));
    req->op.complete = slow_poll_complete;
    req->poll = poll;
    req->socket = poll->socket;
    req->interest = poll->interest;
    if (!DuplicateHandle(GetCurrentProcess(), poll->loop->iocp, GetCurrentProcess(), &req->port, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
        us_free(req);
        WSASetLastError(WSAENOBUFS);
        return -1;
    }
    if (!QueueUserWorkItem(slow_poll_thread, req, WT_EXECUTELONGFUNCTION)) {
        CloseHandle(req->port);
        us_free(req);
        WSASetLastError(WSAENOBUFS);
        return -1;
    }
    poll->slow_requests++;
    poll->slow_submitted_interest = poll->interest;
    us_iocp_op_submitted(poll->loop);
    return 0;
}

/* Socket readiness for polls Bun owns */

struct us_internal_afd_poll *us_iocp_poll_socket(struct us_loop_t *loop, void *owner, SOCKET socket, int events) {
    return afd_poll_create(loop, owner, socket, events);
}

void us_iocp_poll_socket_change(struct us_loop_t *loop, struct us_internal_afd_poll *poll, int events) {
    (void) loop;
    afd_poll_set_interest(poll, events);
}

void us_iocp_poll_socket_stop(struct us_loop_t *loop, struct us_internal_afd_poll *poll) {
    (void) loop;
    afd_poll_stop(poll);
}

/* Waiting on a handle */

struct us_iocp_wait {
    struct us_loop_t *loop;
    /* Wait completion packet, or NULL when the thread-pool fallback is used. */
    HANDLE packet;
    HANDLE registered_wait;
    struct us_iocp_op *op;
    volatile LONG fired;
};

struct us_iocp_wait *us_iocp_wait_create(struct us_loop_t *loop) {
    nt_ensure();
    struct us_iocp_wait *wait = us_calloc(1, sizeof(struct us_iocp_wait));
    wait->loop = loop;
    if (pNtCreateWaitCompletionPacket) {
        if (!NT_SUCCESS(pNtCreateWaitCompletionPacket(&wait->packet, GENERIC_ALL, NULL))) {
            wait->packet = NULL;
        }
    }
    return wait;
}

static VOID CALLBACK iocp_wait_fired(PVOID context, BOOLEAN timed_out) {
    (void) timed_out;
    struct us_iocp_wait *wait = context;
    InterlockedExchange(&wait->fired, 1);
    PostQueuedCompletionStatus(wait->loop->iocp, 0, 0, &wait->op->overlapped);
}

int us_iocp_wait_start(struct us_iocp_wait *wait, HANDLE handle, struct us_iocp_op *op) {
    wait->op = op;
    if (wait->packet) {
        /* An already-signalled handle sets `signalled` and queues the packet all the same. */
        BOOLEAN signalled = FALSE;
        NTSTATUS status = pNtAssociateWaitCompletionPacket(wait->packet, wait->loop->iocp, handle, NULL, op, STATUS_SUCCESS, 0, &signalled);
        if (!NT_SUCCESS(status)) {
            return -1;
        }
        us_iocp_op_submitted(wait->loop);
        return 0;
    }

    /* A one-shot registration stays allocated after it fired. Its callback only posts, so this does not block for long. */
    if (wait->registered_wait) {
        UnregisterWaitEx(wait->registered_wait, INVALID_HANDLE_VALUE);
        wait->registered_wait = NULL;
    }
    wait->fired = 0;
    if (!RegisterWaitForSingleObject(&wait->registered_wait, handle, iocp_wait_fired, wait, INFINITE, WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE)) {
        wait->registered_wait = NULL;
        return -1;
    }
    us_iocp_op_submitted(wait->loop);
    return 0;
}

int us_iocp_wait_stop(struct us_iocp_wait *wait) {
    if (wait->packet) {
        /* With the loop thread as the port's only reader this is STATUS_SUCCESS
         * when the wait was armed or its packet was still queued (the packet is
         * removed), and STATUS_CANCELLED when the packet was already dequeued. */
        if (pNtCancelWaitCompletionPacket(wait->packet, TRUE) == STATUS_SUCCESS) {
            InterlockedDecrement((volatile LONG *) &wait->loop->pending_ops);
            return 1;
        }
        return 0;
    }

    if (!wait->registered_wait) {
        return 0;
    }
    /* Blocks until a running callback returns; the callback only posts to the port. */
    UnregisterWaitEx(wait->registered_wait, INVALID_HANDLE_VALUE);
    wait->registered_wait = NULL;
    if (wait->fired) {
        return 0;
    }
    InterlockedDecrement((volatile LONG *) &wait->loop->pending_ops);
    return 1;
}

void us_iocp_wait_free(struct us_iocp_wait *wait) {
    if (wait->packet) {
        CloseHandle(wait->packet);
    }
    if (wait->registered_wait) {
        UnregisterWaitEx(wait->registered_wait, INVALID_HANDLE_VALUE);
    }
    us_free(wait);
}

/* Loop */

struct us_loop_t *us_create_loop(void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size) {
    if (!nt_ensure()) {
        return NULL;
    }

    struct us_loop_t *loop = (struct us_loop_t *) us_calloc(1, sizeof(struct us_loop_t) + ext_size);

    /* One thread runs the loop; the concurrency value only matters with several readers. */
    loop->iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 1);
    if (loop->iocp == NULL) {
        us_free(loop);
        return NULL;
    }

    /* A wait timeout is otherwise rounded to the 15.6ms scheduler tick. */
    if (pNtCreateWaitCompletionPacket) {
        loop->hrtimer = CreateWaitableTimerExW(NULL, NULL, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
        if (loop->hrtimer && !NT_SUCCESS(pNtCreateWaitCompletionPacket(&loop->hrtimer_packet, GENERIC_ALL, NULL))) {
            CloseHandle(loop->hrtimer);
            loop->hrtimer = NULL;
            loop->hrtimer_packet = NULL;
        }
    }

    if (us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb) != 0) {
        if (loop->hrtimer) {
            CloseHandle(loop->hrtimer_packet);
            CloseHandle(loop->hrtimer);
        }
        CloseHandle(loop->iocp);
        us_free(loop);
        return NULL;
    }
    us_internal_resume_list_add(loop);
    return loop;
}

/* System resume. A wait's timeout does not advance while the machine sleeps,
 * but the deadlines it was computed from (QueryPerformanceCounter) do: a loop
 * that slept through a suspend would fire its timers late by the length of
 * the suspend. An empty packet ends the wait and the caller works out its
 * timers again. */

#ifndef PBT_APMRESUMESUSPEND
#define PBT_APMRESUMESUSPEND 0x0007
#endif
#ifndef PBT_APMRESUMEAUTOMATIC
#define PBT_APMRESUMEAUTOMATIC 0x0012
#endif
#ifndef DEVICE_NOTIFY_CALLBACK
#define DEVICE_NOTIFY_CALLBACK 2
#endif

struct us_internal_power_notify {
    ULONG(CALLBACK *callback)(PVOID context, ULONG type, PVOID setting);
    PVOID context;
};
typedef DWORD(WINAPI *power_register_suspend_resume_fn)(DWORD flags, HANDLE recipient, PVOID *registration);

static SRWLOCK resume_lock = SRWLOCK_INIT;
static struct us_loop_t *resume_loops;
static INIT_ONCE resume_once = INIT_ONCE_STATIC_INIT;

static ULONG CALLBACK us_internal_on_power_event(PVOID context, ULONG type, PVOID setting) {
    (void) context;
    (void) setting;
    if (type == PBT_APMRESUMESUSPEND || type == PBT_APMRESUMEAUTOMATIC) {
        AcquireSRWLockShared(&resume_lock);
        for (struct us_loop_t *loop = resume_loops; loop; loop = loop->resume_next) {
            PostQueuedCompletionStatus(loop->iocp, 0, 0, NULL);
        }
        ReleaseSRWLockShared(&resume_lock);
    }
    return 0;
}

static BOOL CALLBACK us_internal_resume_register(PINIT_ONCE once, PVOID param, PVOID *context) {
    (void) once;
    (void) param;
    (void) context;
    HMODULE powrprof = LoadLibraryExW(L"powrprof.dll", NULL, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (powrprof) {
        power_register_suspend_resume_fn reg = (power_register_suspend_resume_fn) (void *) GetProcAddress(powrprof, "PowerRegisterSuspendResumeNotification");
        if (reg) {
            static struct us_internal_power_notify recipient = {us_internal_on_power_event, NULL};
            PVOID registration;
            reg(DEVICE_NOTIFY_CALLBACK, &recipient, &registration);
        }
    }
    return TRUE;
}

static void us_internal_resume_list_add(struct us_loop_t *loop) {
    AcquireSRWLockExclusive(&resume_lock);
    loop->resume_next = resume_loops;
    if (resume_loops) {
        resume_loops->resume_prev = loop;
    }
    resume_loops = loop;
    ReleaseSRWLockExclusive(&resume_lock);
}

static void us_internal_resume_list_remove(struct us_loop_t *loop) {
    AcquireSRWLockExclusive(&resume_lock);
    if (loop->resume_prev) {
        loop->resume_prev->resume_next = loop->resume_next;
    } else {
        resume_loops = loop->resume_next;
    }
    if (loop->resume_next) {
        loop->resume_next->resume_prev = loop->resume_prev;
    }
    ReleaseSRWLockExclusive(&resume_lock);
}

/* Runs what is left of the dequeued batch. A dequeued packet exists nowhere
 * else, and a callback can re-enter the loop: the entry is copied and the
 * index moved past it first, so that the nested tick finishes this batch
 * before its own wait overwrites it. */
static void us_internal_dispatch_ready_polls(struct us_loop_t *loop) {
    while (loop->current_ready_poll < loop->num_ready_polls) {
        OVERLAPPED_ENTRY entry = loop->ready_polls[loop->current_ready_poll++];
        /* A packet without an OVERLAPPED only ends the wait: the wait timer fired, or
         * the system resumed. A relative timer does not count the time suspended, so
         * after a resume the armed one is later than the deadline it was armed for. */
        if (!entry.lpOverlapped) {
            loop->hrtimer_deadline_ns = 0;
            continue;
        }
        InterlockedDecrement((volatile LONG *) &loop->pending_ops);
        struct us_iocp_op *op = (struct us_iocp_op *) entry.lpOverlapped;
        op->complete(loop, op, &entry);
    }
}

/* Completes the ops that were ready when the tick began; one that becomes ready
 * meanwhile is the next tick's, so the port is looked at in between. Each is
 * taken off the list before it runs: a callback can re-enter the loop, and the
 * nested tick carries on with the rest. */
static void us_internal_complete_ready_ops(struct us_loop_t *loop) {
    for (unsigned int budget = loop->num_ready_ops; budget && loop->ready_ops_head; budget--) {
        struct us_iocp_op *op = loop->ready_ops_head;
        loop->ready_ops_head = op->next_ready;
        if (!loop->ready_ops_head) {
            loop->ready_ops_tail = NULL;
        }
        loop->num_ready_ops--;
        InterlockedDecrement((volatile LONG *) &loop->pending_ops);
        OVERLAPPED_ENTRY entry = {0};
        entry.lpOverlapped = &op->overlapped;
        op->complete(loop, op, &entry);
    }
}

static void us_internal_iocp_dequeue(struct us_loop_t *loop, DWORD timeout_ms) {
    ULONG count = 0;
    if (!GetQueuedCompletionStatusEx(loop->iocp, loop->ready_polls, US_IOCP_MAX_ENTRIES, &count, timeout_ms, FALSE)) {
        count = 0;
    }
    loop->num_ready_polls = (int) count;
    loop->current_ready_poll = 0;
}

/* What has to happen before a wait, outside of it: see us_internal_iocp_wait. */
static void us_internal_before_wait(struct us_loop_t *loop, long long timeout_ns) {
    if (timeout_ns != 0) {
        /* Not at startup: this loads powrprof.dll, and only a wait that blocks needs it. */
        InitOnceExecuteOnce(&resume_once, us_internal_resume_register, NULL, NULL);
    }
    afd_flush_updates(loop);
}

/* timeout_ns < 0 waits forever. Nothing in here touches the heap: the tick
 * calls it after handing this thread's heaps to the mimalloc scavenger. */
static void us_internal_iocp_wait(struct us_loop_t *loop, long long timeout_ns, uint64_t now_ns) {
    DWORD timeout_ms;
    uint64_t deadline_ns = 0;
    if (timeout_ns < 0) {
        timeout_ms = INFINITE;
    } else if (timeout_ns == 0) {
        timeout_ms = 0;
    } else if (loop->hrtimer) {
        /* `timeout_ns` counts from the reading the caller took to pick it, so
         * for one pending timer `due_ns` is the same value tick after tick.
         * A caller without a reading counts from here. */
        const uint64_t armed_at_ns = us_internal_monotonic_ns();
        const uint64_t due_ns = (now_ns ? now_ns : armed_at_ns) + (uint64_t) timeout_ns;
        if (loop->hrtimer_deadline_ns && loop->hrtimer_deadline_ns <= due_ns) {
            /* The armed timer ends this wait in time. If it is early, the tick
             * it ends finds nothing due and the next one arms again; arming on
             * every wait is three syscalls. */
            timeout_ms = INFINITE;
        } else if (due_ns <= armed_at_ns) {
            timeout_ms = 0;
        } else {
            /* Cancel, set, associate, in this order: a packet from the previous
             * expiry is removed before the timer can fire again. */
            pNtCancelWaitCompletionPacket(loop->hrtimer_packet, TRUE);
            LARGE_INTEGER due;
            due.QuadPart = -(LONGLONG) ((due_ns - armed_at_ns + 99) / 100);
            BOOLEAN signalled = FALSE;
            if (SetWaitableTimer(loop->hrtimer, &due, 0, NULL, NULL, FALSE) &&
                NT_SUCCESS(pNtAssociateWaitCompletionPacket(loop->hrtimer_packet, loop->iocp, loop->hrtimer, (PVOID) HRTIMER_COMPLETION_KEY, NULL, STATUS_SUCCESS, 0, &signalled))) {
                loop->hrtimer_deadline_ns = due_ns;
                timeout_ms = INFINITE;
            } else {
                loop->hrtimer_deadline_ns = 0;
                uint64_t ms = ((uint64_t) timeout_ns + 999999ULL) / 1000000ULL;
                timeout_ms = ms >= INFINITE ? INFINITE - 1 : (DWORD) ms;
            }
        }
    } else {
        uint64_t ms = ((uint64_t) timeout_ns + 999999ULL) / 1000000ULL;
        timeout_ms = ms >= INFINITE ? INFINITE - 1 : (DWORD) ms;
        deadline_ns = us_internal_monotonic_ns() + (uint64_t) timeout_ns;
    }

    for (;;) {
        us_internal_iocp_dequeue(loop, timeout_ms);
        if (loop->num_ready_polls != 0 || !deadline_ns) {
            return;
        }
        /* A millisecond timeout can return up to a scheduler tick early. */
        uint64_t now = us_internal_monotonic_ns();
        if (now >= deadline_ns) {
            return;
        }
        timeout_ms = (DWORD) ((deadline_ns - now + 999999ULL) / 1000000ULL);
    }
}

/* The Rust callers pass two int64_t; tv_nsec is a 32-bit long here. */
_Static_assert(sizeof(struct timespec) == 16 && offsetof(struct timespec, tv_nsec) == 8, "struct timespec layout");

static long long us_internal_timespec_ns(const struct timespec *timeout) {
    if (!timeout) {
        return -1;
    }
    /* Only NULL waits forever: epoll_pwait2/kevent reject a negative timespec rather than block on it. */
    long long ns = (long long) timeout->tv_sec * 1000000000LL + (long long) timeout->tv_nsec;
    return ns < 0 ? 0 : ns;
}

/* A tick dispatches one batch of packets: what runs between ticks (timers, the
 * loop's post handlers) waits for no more than that. A poll that was cancelled
 * to widen its mask is the exception: it goes back to the kernel and the port
 * is looked at once more, so the events asked for arrive in this tick. */
static void us_internal_resubmit_cancelled_polls(struct us_loop_t *loop) {
    if (!loop->afd_saw_cancelled || loop->num_polls <= 0) {
        return;
    }
    loop->afd_saw_cancelled = 0;
    afd_flush_updates(loop);
    us_internal_iocp_dequeue(loop, 0);
    us_internal_dispatch_ready_polls(loop);
}

/* Bound `timeout_ns` by the socket-timeout sweep deadline. */
static long long us_internal_clamp_to_sweep(struct us_loop_t *loop, long long timeout_ns) {
    long long sweep_ns = us_internal_sweep_timeout_ns(loop);
    if (sweep_ns < 0) {
        return timeout_ns;
    }
    if (timeout_ns >= 0 && timeout_ns <= sweep_ns) {
        return timeout_ns;
    }
    return sweep_ns;
}

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec *timeout, uint64_t now_ns) {
    /* An unref'd poll still counts in num_polls on every backend, so a tick
     * still collects its events. Here the same goes for anything in flight on
     * the port that is not a poll (a process-exit wait, a pipe read): with
     * only those left, the caller's non-blocking tick must still dequeue them. */
    if (loop->num_polls == 0 && loop->pending_ops == 0)
        return;

    loop->data.tick_depth++;

    us_internal_loop_pre(loop);
    acceptors_retry_starved(loop);

    /* Only a tick entered from a completion callback has anything left here. */
    us_internal_dispatch_ready_polls(loop);
    us_internal_complete_ready_ops(loop);

    long long timeout_ns = us_internal_timespec_ns(timeout);

    /* loop_pre runs lsquic_engine_process_conns and stores the soonest
     * earliest_adv_tick. The JS event loop folds this in itself; other callers
     * (HTTP thread) pass NULL, so fold it here so QUIC retransmit/idle timers
     * fire without other I/O waking us. */
    if (loop->data.quic_head && loop->data.quic_next_tick_us >= 0) {
        long long quic_ns = loop->data.quic_next_tick_us * 1000LL;
        if (timeout_ns < 0 || timeout_ns > quic_ns) {
            timeout_ns = quic_ns;
        }
    }

    timeout_ns = us_internal_clamp_to_sweep(loop, timeout_ns);

    if (timeout_ns != 0 && loop->data.jsc_vm)
        Bun__JSC_onBeforeWait(loop->data.jsc_vm);

    /* No packet stands behind a ready op: nothing would end a wait for it. */
    if (loop->ready_ops_head)
        timeout_ns = 0;

    /* What follows prepares to park the thread. A tick that finds packets
     * waiting does not park, however long it would have been willing to.
     * After the finalizers above, which stop polls: the flush frees them. */
    int found_packets = 0;
    if (timeout_ns != 0) {
        afd_flush_updates(loop);
        us_internal_iocp_dequeue(loop, 0);
        found_packets = loop->num_ready_polls != 0;
    }
    const int will_idle_inside_event_loop = timeout_ns != 0 && !found_packets;

    /* Before the hand-off below: this frees. */
    if (!found_packets)
        us_internal_before_wait(loop, timeout_ns);

    /* The scavenger sweeps our heaps while we are in the kernel. Must come after
     * Bun__JSC_onBeforeWait, which allocates: nothing may touch our heaps until the matching
     * _end. Only on a tick that really parks: the hand-off wakes the scavenger thread (a
     * syscall), and a tick that does not block takes the heaps back before it could sweep.
     * With no scavenger to hand off to, fall back to sweeping inline, rate-limited. */
    const int handed_off = will_idle_inside_event_loop && mi_on_thread_idle_start();
    if (!handed_off && will_idle_inside_event_loop)
        us_internal_idle_sweep(now_ns);

    if (!found_packets)
        us_internal_iocp_wait(loop, timeout_ns, now_ns);

    /* Before anything can allocate again. */
    if (handed_off)
        mi_on_thread_idle_end();

    us_internal_dispatch_ready_polls(loop);
    us_internal_resubmit_cancelled_polls(loop);
    us_internal_sweep_if_due(loop);

    us_internal_loop_post(loop);
    loop->data.tick_depth--;
}

void us_loop_free(struct us_loop_t *loop) {
    /* A poll whose owner never stopped it must not run that owner from the
     * drain below, nor be re-armed by it. Cancelled here, its packet comes
     * back at once instead of holding the drain for its full duration. */
    loop->closing = 1;
    us_internal_resume_list_remove(loop);
    for (struct us_internal_afd_helper *helper = loop->afd_helpers; helper; helper = helper->next) {
        IO_STATUS_BLOCK cancel_iosb;
        pNtCancelIoFileEx(helper->handle, NULL, &cancel_iosb);
    }
    acceptors_cancel(loop);

    us_internal_loop_data_free(loop);

    if (loop->hrtimer) {
        pNtCancelWaitCompletionPacket(loop->hrtimer_packet, TRUE);
        CloseHandle(loop->hrtimer_packet);
        CloseHandle(loop->hrtimer);
    }

    /* Every op still out there was cancelled by its owner, but its memory
     * belongs to the kernel until its packet is dequeued. Bounded: whatever
     * has not come back by then stays allocated rather than being freed under
     * the kernel. */
    for (int rounds = 0; rounds < 64; rounds++) {
        afd_flush_updates(loop);
        us_internal_complete_ready_ops(loop);
        if (loop->pending_ops == 0) {
            break;
        }
        us_internal_iocp_dequeue(loop, 16);
        us_internal_dispatch_ready_polls(loop);
    }

    while (loop->afd_helpers) {
        struct us_internal_afd_helper *next = loop->afd_helpers->next;
        if (loop->afd_helpers->count == 0) {
            CloseHandle(loop->afd_helpers->handle);
            us_free(loop->afd_helpers);
        }
        loop->afd_helpers = next;
    }

    CloseHandle(loop->iocp);
    us_free(loop);
}

/* Accepting */

/* A listening socket is not polled for readiness. accept() on a non-blocking
 * socket is a readiness check followed by a wait for the connection, and when
 * several acceptors share the socket (cluster workers, the loops of two
 * threads) another one can take the connection in between, which leaves this
 * thread blocked in that wait. An overlapped AcceptEx is handed a connection by
 * the kernel or stays pending, however many acceptors there are. */

#define US_ACCEPT_ADDRESS_LENGTH ((DWORD) (sizeof(struct sockaddr_storage) + 16))

/* One AcceptEx is outstanding per listener. The kernel owns its OVERLAPPED and
 * buffer until its packet is dequeued, so this is freed only once the listener
 * stopped and none is in flight. */
struct us_internal_acceptor {
    struct us_iocp_op op;
    struct us_poll_t *owner;
    struct us_loop_t *loop;
    SOCKET listener;
    int family;
    int type;
    int protocol;
    LPFN_ACCEPTEX accept_ex;
    LPFN_GETACCEPTEXSOCKADDRS get_addresses;
    /* The socket's file object is associated with another completion port
     * (another loop or process accepts on it too), and a file object has only
     * one. Each AcceptEx then carries an event with its low bit set, which
     * queues nothing to that port, and a wait on the event delivers it here. */
    unsigned char by_event;
    HANDLE event;
    struct us_iocp_wait *wait;
    /* Handed to the outstanding AcceptEx, or accepted and not taken yet. */
    SOCKET socket;
    unsigned char in_flight;
    unsigned char accepted;
    /* Neither AcceptEx nor a poll could be started. Every tick tries again,
     * and the sweep timer it holds keeps ticks coming. */
    unsigned char starved;
    /* Depth of acceptor_complete frames dispatching to the owner: a
     * callback can run the loop again, and close the listener from there. */
    unsigned int dispatching;
    struct us_internal_acceptor *next;
    struct us_internal_acceptor *prev;
    char addresses[2 * US_ACCEPT_ADDRESS_LENGTH];
};

static void acceptor_set_starved(struct us_internal_acceptor *a, int starved) {
    if (a->starved == starved) {
        return;
    }
    a->starved = (unsigned char) starved;
    if (starved) {
        us_internal_enable_sweep_timer(a->loop);
    } else {
        us_internal_disable_sweep_timer(a->loop);
    }
}

static void acceptor_maybe_free(struct us_internal_acceptor *a) {
    if (a->owner || a->in_flight || a->dispatching) {
        return;
    }
    acceptor_set_starved(a, 0);
    if (a->socket != INVALID_SOCKET) {
        closesocket(a->socket);
    }
    if (a->wait) {
        us_iocp_wait_free(a->wait);
    }
    if (a->event) {
        CloseHandle(a->event);
    }
    if (a->prev) {
        a->prev->next = a->next;
    } else {
        a->loop->acceptors = a->next;
    }
    if (a->next) {
        a->next->prev = a->prev;
    }
    us_free(a);
}

/* Returns 0 once a packet for the AcceptEx is on its way. */
static int acceptor_start(struct us_internal_acceptor *a) {
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_SOCKET, a->listener, injected, unused)) {
        return -1;
    }
#endif
    a->socket = WSASocketW(a->family, a->type, a->protocol, NULL, 0, WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT);
    if (a->socket == INVALID_SOCKET) {
        return -1;
    }
    memset(&a->op.overlapped, 0, sizeof(a->op.overlapped));
    if (a->by_event) {
        ResetEvent(a->event);
        a->op.overlapped.hEvent = (HANDLE) ((ULONG_PTR) a->event | 1);
    }
    DWORD bytes;
    if (!a->accept_ex(a->listener, a->socket, a->addresses, 0, US_ACCEPT_ADDRESS_LENGTH, US_ACCEPT_ADDRESS_LENGTH, &bytes, &a->op.overlapped) &&
        WSAGetLastError() != ERROR_IO_PENDING) {
        int err = WSAGetLastError();
        closesocket(a->socket);
        a->socket = INVALID_SOCKET;
        WSASetLastError(err);
        return -1;
    }
    if (!a->by_event) {
        /* Also when it succeeded at once: the packet is queued all the same. */
        us_iocp_op_submitted(a->loop);
    } else if (us_iocp_wait_start(a->wait, a->event, &a->op) != 0) {
        /* Nothing will announce the completion, so collect it here. */
        CancelIoEx((HANDLE) a->listener, &a->op.overlapped);
        WaitForSingleObject(a->event, INFINITE);
        closesocket(a->socket);
        a->socket = INVALID_SOCKET;
        WSASetLastError(WSAENOBUFS);
        return -1;
    }
    a->in_flight = 1;
    return 0;
}

/* Keep the listener accepting. If AcceptEx cannot be started (out of sockets or
 * memory), the listener is polled for a waiting connection instead, and
 * us_internal_accept tries again when there is one. */
static void acceptor_arm(struct us_internal_acceptor *a) {
    /* A connection that was reset while it waited fails the call that would have taken it. */
    for (int attempt = 0; attempt < 8; attempt++) {
        if (acceptor_start(a) == 0) {
            if (a->owner->afd) {
                afd_poll_stop(a->owner->afd);
                a->owner->afd = NULL;
            }
            acceptor_set_starved(a, 0);
            return;
        }
        if (WSAGetLastError() != WSAECONNRESET) {
            break;
        }
    }
    /* A poll whose re-submit failed is neither with the kernel nor queued to go there. */
    struct us_internal_afd_poll *poll = a->owner->afd;
    if (poll && poll->state == AFD_POLL_STATE_IDLE && !poll->queued_for_update && !poll->slow_requests) {
        afd_poll_stop(poll);
        a->owner->afd = NULL;
    }
    if (!a->owner->afd) {
        a->owner->afd = afd_poll_create(a->loop, a->owner, a->listener, LIBUS_SOCKET_READABLE);
    }
    acceptor_set_starved(a, a->owner->afd == NULL);
}

static void acceptors_retry_starved(struct us_loop_t *loop) {
    for (struct us_internal_acceptor *a = loop->acceptors; a; a = a->next) {
        if (!a->starved || !a->owner) {
            continue;
        }
        if (!a->in_flight && !a->accepted) {
            acceptor_arm(a);
        }
    }
}

static void acceptor_complete(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry) {
    (void) loop;
    (void) entry;
    struct us_internal_acceptor *a = (struct us_internal_acceptor *) op;
    a->in_flight = 0;

    if (!a->owner || a->loop->closing) {
        acceptor_maybe_free(a);
        return;
    }

    /* The status AcceptEx left in the OVERLAPPED; an error is the connection's
     * (it was reset before it could be accepted), not the listener's. */
    int ok = NT_SUCCESS((NTSTATUS) a->op.overlapped.Internal);
    if (ok) {
        SOCKET listener = a->listener;
        ok = setsockopt(a->socket, SOL_SOCKET, SO_UPDATE_ACCEPT_CONTEXT, (const char *) &listener, sizeof(listener)) == 0;
    }
    if (!ok) {
        closesocket(a->socket);
        a->socket = INVALID_SOCKET;
        acceptor_arm(a);
        return;
    }

    a->accepted = 1;
    a->dispatching++;
    us_internal_dispatch_ready_poll(a->owner, 0, 0, LIBUS_SOCKET_READABLE);
    a->dispatching--;
    if (a->accepted) {
        /* Not taken: the listener was closed first, or us_internal_accept was made
         * to fail. Reset, as the connections still in the backlog are. */
        a->accepted = 0;
        struct linger reset = {.l_onoff = 1, .l_linger = 0};
        setsockopt(a->socket, SOL_SOCKET, SO_LINGER, (const char *) &reset, sizeof(reset));
        closesocket(a->socket);
        a->socket = INVALID_SOCKET;
    }
    /* The owner accepts until nothing is left, which starts AcceptEx again.
     * When it stopped before that, this does. */
    if (a->owner && !a->in_flight) {
        acceptor_arm(a);
    }
    acceptor_maybe_free(a);
}

static void acceptor_cancel(struct us_internal_acceptor *a) {
    if (a->in_flight) {
        CancelIoEx((HANDLE) a->listener, &a->op.overlapped);
    }
}

static void acceptors_cancel(struct us_loop_t *loop) {
    for (struct us_internal_acceptor *a = loop->acceptors; a; a = a->next) {
        acceptor_cancel(a);
    }
}

static void acceptor_stop(struct us_internal_acceptor *a) {
    a->owner = NULL;
    acceptor_set_starved(a, 0);
    acceptor_cancel(a);
    acceptor_maybe_free(a);
}

/* NULL when the socket has to be polled and accept()ed instead: its provider
 * is not AFD (a non-IFS LSP), or it is not listening yet. */
static struct us_internal_acceptor *acceptor_create(struct us_loop_t *loop, struct us_poll_t *owner, int foreign) {
    SOCKET listener = owner->fd;
    WSAPROTOCOL_INFOW info;
    int info_length = sizeof(info);
    int not_a_socket;
    if (getsockopt(listener, SOL_SOCKET, SO_PROTOCOL_INFOW, (char *) &info, &info_length) != 0 ||
        afd_base_socket(listener, &not_a_socket) == INVALID_SOCKET) {
        return NULL;
    }
    GUID accept_ex_id = WSAID_ACCEPTEX;
    GUID get_addresses_id = WSAID_GETACCEPTEXSOCKADDRS;
    LPFN_ACCEPTEX accept_ex = NULL;
    LPFN_GETACCEPTEXSOCKADDRS get_addresses = NULL;
    DWORD bytes;
    if (WSAIoctl(listener, SIO_GET_EXTENSION_FUNCTION_POINTER, &accept_ex_id, sizeof(accept_ex_id), &accept_ex, sizeof(accept_ex), &bytes, NULL, NULL) != 0 ||
        WSAIoctl(listener, SIO_GET_EXTENSION_FUNCTION_POINTER, &get_addresses_id, sizeof(get_addresses_id), &get_addresses, sizeof(get_addresses), &bytes, NULL,
                 NULL) != 0) {
        return NULL;
    }

    /* The backlog behind the connection AcceptEx took is drained with accept(). */
    u_long nonblocking = 1;
    if (ioctlsocket(listener, FIONBIO, &nonblocking) == SOCKET_ERROR) {
        return NULL;
    }

    struct us_internal_acceptor *a = us_calloc(1, sizeof(struct us_internal_acceptor));
    a->owner = owner;
    a->loop = loop;
    a->listener = listener;
    a->family = info.iAddressFamily;
    a->type = info.iSocketType;
    a->protocol = info.iProtocol;
    a->accept_ex = accept_ex;
    a->get_addresses = get_addresses;
    /* A completion port belongs to the file object, for good and for every
     * process that holds the socket, so only a socket made here is given one. */
    a->by_event = foreign || CreateIoCompletionPort((HANDLE) listener, loop->iocp, 0, 0) == NULL;
    a->next = loop->acceptors;
    if (a->next) {
        a->next->prev = a;
    }
    loop->acceptors = a;

    a->op.complete = acceptor_complete;
    a->socket = INVALID_SOCKET;
    int started = 1;
    if (a->by_event) {
        a->event = CreateEventW(NULL, TRUE, FALSE, NULL);
        a->wait = a->event ? us_iocp_wait_create(loop) : NULL;
        started = a->wait != NULL;
    }
    if (started && acceptor_start(a) != 0) {
        started = 0;
    }
    if (!started) {
        acceptor_stop(a);
        return NULL;
    }
    return a;
}

int us_internal_poll_start_accepting(struct us_poll_t *p, struct us_loop_t *loop, int foreign) {
#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION
    /* A listener's poll registration. */
    ssize_t injected = 0;
    int unused = 0;
    if (US_FAULT_CHECK(US_FAULT_POLL_START, p->fd, injected, unused)) {
        errno = (int) -injected;
        return (int) injected;
    }
#endif
    if (nt_ensure()) {
        p->acceptor = acceptor_create(loop, p, foreign);
        if (p->acceptor) {
            p->poll_type = (unsigned char) (us_internal_poll_type(p) | POLL_TYPE_POLLING_IN);
            return 0;
        }
    }
    return us_poll_start_rc(p, loop, LIBUS_SOCKET_READABLE);
}

LIBUS_SOCKET_DESCRIPTOR us_internal_accept(struct us_poll_t *p, struct bsd_addr_t *addr) {
    struct us_internal_acceptor *a = p->acceptor;
    if (!a) {
        return bsd_accept_socket(p->fd, addr);
    }
    if (a->accepted) {
        ssize_t injected = 0;
        int unused = 0;
        if (US_FAULT_CHECK(US_FAULT_ACCEPT, p->fd, injected, unused)) {
            return LIBUS_SOCKET_ERROR;
        }
        (void) injected;
        (void) unused;
        SOCKET accepted = a->socket;
        a->accepted = 0;
        a->socket = INVALID_SOCKET;

        struct sockaddr *local = NULL;
        struct sockaddr *remote = NULL;
        int local_length = 0;
        int remote_length = 0;
        a->get_addresses(a->addresses, 0, US_ACCEPT_ADDRESS_LENGTH, US_ACCEPT_ADDRESS_LENGTH, &local, &local_length, &remote, &remote_length);
        if (remote_length < 0 || (size_t) remote_length > sizeof(addr->mem)) {
            remote_length = 0;
        }
        memset(&addr->mem, 0, sizeof(addr->mem));
        if (remote_length) {
            memcpy(&addr->mem, remote, (size_t) remote_length);
        }
        addr->len = remote_length;
        internal_finalize_bsd_addr(addr);

        return accepted;
    }
    if (a->in_flight) {
        /* An AcceptEx is outstanding: the next connection is the one it takes. */
        return LIBUS_SOCKET_ERROR;
    }
    /* What AcceptEx took has been handed over. The callers accept until nothing
     * is left, as on the other backends: the rest of the backlog, oldest first,
     * and then AcceptEx waits for the next connection. */
    LIBUS_SOCKET_DESCRIPTOR next = bsd_accept_socket(a->listener, addr);
    if (next != LIBUS_SOCKET_ERROR) {
        return next;
    }
    acceptor_arm(a);
    return LIBUS_SOCKET_ERROR;
}

/* Poll */

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    if (!fallthrough) {
        loop->num_polls++;
    }
    struct us_poll_t *p = us_malloc(sizeof(struct us_poll_t) + ext_size);
    p->afd = NULL;
    p->acceptor = NULL;
    return p;
}

void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
    if (p->afd) {
        afd_poll_stop(p->afd);
    }
    if (p->acceptor) {
        acceptor_stop(p->acceptor);
    }
    loop->num_polls--;
    us_free(p);
}

void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type) {
    p->afd = NULL;
    p->acceptor = NULL;
    p->fd = fd;
    p->poll_type = (unsigned char) poll_type;
}

int us_poll_events(struct us_poll_t *p) {
    return ((p->poll_type & POLL_TYPE_POLLING_IN) ? LIBUS_SOCKET_READABLE : 0) | ((p->poll_type & POLL_TYPE_POLLING_OUT) ? LIBUS_SOCKET_WRITABLE : 0);
}

LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) {
    return p->fd;
}

int us_internal_poll_type(struct us_poll_t *p) {
    return p->poll_type & POLL_TYPE_KIND_MASK;
}

void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
    p->poll_type = (unsigned char) (poll_type | (p->poll_type & POLL_TYPE_POLLING_MASK));
}

struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int old_ext_size, unsigned int ext_size) {
    unsigned int old_size = sizeof(struct us_poll_t) + old_ext_size;
    unsigned int new_size = sizeof(struct us_poll_t) + ext_size;
    if (new_size <= old_size) return p;

    struct us_poll_t *new_p = us_calloc(1, new_size);
    memcpy(new_p, p, old_size);

    /* The old poll is freed separately, which decrements the count again. */
    loop->num_polls++;

    if (new_p->afd) {
        new_p->afd->owner = new_p;
        p->afd = NULL;
    }
    if (new_p->acceptor) {
        new_p->acceptor->owner = new_p;
        p->acceptor = NULL;
    }
    return new_p;
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    p->poll_type = (unsigned char) (us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0));

    /* Readiness only means something for a non-blocking socket. This is also
     * where a descriptor that is not a socket gets rejected. */
    u_long nonblocking = 1;
    if (ioctlsocket(p->fd, FIONBIO, &nonblocking) != SOCKET_ERROR) {
        p->afd = afd_poll_create(loop, p, p->fd, events);
        if (p->afd) {
            return 0;
        }
    }
    /* The callers report errno. */
    errno = WSAGetLastError();
    return -1;
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    us_poll_start_rc(p, loop, events);
}

int us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    if (us_poll_events(p) == events) {
        return 0;
    }
    p->poll_type = (unsigned char) (us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0));
    (void) loop;
    if (p->acceptor || !p->afd) {
        return 0;
    }
    afd_poll_set_interest(p->afd, events);
    return 0;
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    (void) loop;
    if (p->afd) {
        afd_poll_stop(p->afd);
        p->afd = NULL;
    }
    if (p->acceptor) {
        acceptor_stop(p->acceptor);
        p->acceptor = NULL;
    }
}

size_t us_internal_accept_poll_event(struct us_poll_t *p) {
    (void) p;
    return 0;
}

/* Async (internal helper for loop's wakeup feature) */

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_calloc(1, sizeof(struct us_internal_callback_t) + ext_size);
    cb->loop = loop;
    cb->fallthrough = fallthrough;
    us_poll_init(&cb->p, INVALID_SOCKET, POLL_TYPE_CALLBACK);

    if (!fallthrough) {
        loop->num_polls++;
    }
    return (struct us_internal_async *) cb;
}

static void us_internal_async_complete(struct us_loop_t *loop, struct us_iocp_op *op, OVERLAPPED_ENTRY *entry) {
    (void) loop;
    (void) entry;
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) ((char *) op - offsetof(struct us_internal_callback_t, op));
    /* Cleared before the callback: a wakeup sent while it runs must post again. */
    InterlockedExchange(&cb->posted, 0);
    if (cb->closed) {
        us_free(cb);
        return;
    }
    cb->cb((struct us_internal_callback_t *) cb->loop);
}

void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) a;
    if (!cb->fallthrough) {
        cb->loop->num_polls--;
    }
    cb->closed = 1;
    /* A posted packet still points here; its completion frees it. */
    if (!InterlockedCompareExchange(&cb->posted, 1, 0)) {
        us_free(cb);
    }
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;
    internal_cb->op.complete = us_internal_async_complete;
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) a;
    /* At most one packet in flight however many threads wake the loop. */
    if (InterlockedExchange(&cb->posted, 1) == 0) {
        us_iocp_op_submitted(cb->loop);
        if (!PostQueuedCompletionStatus(cb->loop->iocp, 0, 0, &cb->op.overlapped)) {
            InterlockedDecrement((volatile LONG *) &cb->loop->pending_ops);
            InterlockedExchange(&cb->posted, 0);
        }
    }
}

#endif
