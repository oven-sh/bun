/* Pipes for the Windows backend: the LIBUS_POLL_KIND_PIPE* polls of iocp.c.
 *
 * A pipe handle is never bound to the completion port. Being bound is a property of the file object, which
 * a child process or whoever gave us the handle shares, and it cannot be undone while anything is in flight.
 * Instead every operation has an event of its own and no APC context (so a port somebody else bound gets
 * nothing either), and a wait completion packet turns the event into a packet for our port.
 *
 * Readable: a read of zero bytes completes when there is data or the peer is gone, and takes nothing.
 * Writable: pipes have no such notion. A write that does not fit is not refused, it is queued, its bytes are
 * visible to the reader at once, and taking it back loses an unknown part of it. So the write that finds the pipe
 * full stays queued, on a copy of its bytes, and the caller is told that it would block. The pipe is writable again
 * when that write completes, and the caller, who then offers the same bytes again, is told that they are written.
 * So nobody hears "written" before the system has the bytes, which is what everybody who writes to a socket goes by.
 * The price is the rule of SSL_write: what follows a write that would block begins with the same bytes. */

#include "libusockets.h"
#include "internal/internal.h"

#ifdef LIBUS_USE_IOCP

#include "internal/eventing/iocp_internal.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>

#define LIBUS_FSCTL_PIPE_LISTEN 0x110008
#define LIBUS_FSCTL_PIPE_PEEK 0x11400c
#define LIBUS_FSCTL_PIPE_WAIT 0x110018
#define LIBUS_FSCTL_PIPE_FLUSH 0x118040

/* FILE_INFORMATION_CLASS */
enum {
    LIBUS_FILE_MODE_INFORMATION = 16,
    LIBUS_FILE_PIPE_INFORMATION = 23,
    LIBUS_FILE_PIPE_LOCAL_INFORMATION = 24,
};
#define LIBUS_FILE_PIPE_MESSAGE_TYPE 1
#define LIBUS_FILE_PIPE_QUEUE_OPERATION 0

/* The quota of the pipes Bun creates. A write of at most this much completes on the spot whenever the pipe is
 * empty, and what a queued write holds is charged to the process as nonpaged pool. */
#define LIBUS_PIPE_CHUNK 65536

/* The most one call writes or queues. A reader that keeps up makes every write complete on the spot, and the loop
 * gets a turn after this much. */
#define LIBUS_PIPE_MAX_WRITE (16 * LIBUS_PIPE_CHUNK)

/* The longest pause between two attempts to get a helper thread out of a call. */
#define LIBUS_PIPE_RETRY_MAX_MS 128

/* How long the peer of a pipe that was shut down can stay silent before our end is closed. */
#define LIBUS_PIPE_EOF_TIMEOUT_MS 50

/* How long to wait for a server whose instances are all taken. */
#define LIBUS_PIPE_BUSY_TIMEOUT_MS 30000

#define LIBUS_PIPE_INSTANCES 4

/* The helper threads call the system and little else. What they would commit otherwise is what the executable asks for
 * its main thread. */
#define LIBUS_HELPER_STACK_COMMIT (64 * 1024)

static char us_internal_pipe_nothing;

struct us_internal_pipe_op_t {
    struct us_internal_iocp_op_t op;
    /* Set when the operation completes. A timer, if the operation is a pause. */
    HANDLE event;
    HANDLE packet;
    /* The packet is waiting, or is on its way to on_complete. */
    unsigned char is_armed;
};

static IO_STATUS_BLOCK *us_internal_pipe_op_iosb(struct us_internal_pipe_op_t *op) {
    return (IO_STATUS_BLOCK *) &op->op.ov.Internal;
}

/* On failure the reason is in LIBUS_ERR. */
static int us_internal_pipe_op_init_as(struct us_internal_pipe_op_t *op, int is_timer,
    void (*on_complete)(struct us_loop_t *, struct us_internal_iocp_op_t *)) {
    if (op->packet) {
        return 0;
    }
    HANDLE event = is_timer ? CreateWaitableTimerW(NULL, TRUE, NULL) : CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!event) {
        return -1;
    }
    NTSTATUS status = NtCreateWaitCompletionPacket(&op->packet, LIBUS_WAIT_COMPLETION_PACKET_ALL_ACCESS, NULL);
    if (status != STATUS_SUCCESS) {
        op->packet = NULL;
        NtClose(event);
        SetLastError(RtlNtStatusToDosError(status));
        return -1;
    }
    op->event = event;
    op->op.on_complete = on_complete;
    return 0;
}

static int us_internal_pipe_op_init(struct us_internal_pipe_op_t *op,
    void (*on_complete)(struct us_loop_t *, struct us_internal_iocp_op_t *)) {
    return us_internal_pipe_op_init_as(op, 0, on_complete);
}

static void us_internal_pipe_op_destroy(struct us_internal_pipe_op_t *op) {
    if (op->packet) NtClose(op->packet);
    if (op->event) NtClose(op->event);
}

/* Arms the packet: on_complete runs once `target` is signaled. */
static int us_internal_pipe_op_arm(struct us_internal_poll_req_t *req, struct us_internal_pipe_op_t *op, HANDLE target) {
    NTSTATUS status = NtAssociateWaitCompletionPacket(op->packet, req->loop->iocp, target, NULL, &op->op, STATUS_SUCCESS, 0, NULL);
    if (status != STATUS_SUCCESS) {
        return -1;
    }
    op->is_armed = 1;
    us_internal_iocp_op_started(req);
    return 0;
}

/* Arms the packet for the operation that `file` has pending. If that fails, cancels the operation and waits until it is over. */
static int us_internal_pipe_op_arm_or_cancel(struct us_internal_poll_req_t *req, struct us_internal_pipe_op_t *op, HANDLE file) {
    if (us_internal_pipe_op_arm(req, op, op->event) == 0) {
        return 0;
    }
    IO_STATUS_BLOCK io_status;
    NtCancelIoFileEx(file, us_internal_pipe_op_iosb(op), &io_status);
    NtWaitForSingleObject(op->event, FALSE, NULL);
    return -1;
}

/* Takes back an operation on `file` (NULL: there is none, the packet waits for something else). If the
 * operation is still armed afterwards, on_complete is yet to run. */
static void us_internal_pipe_op_cancel(struct us_internal_poll_req_t *req, struct us_internal_pipe_op_t *op, HANDLE file) {
    if (!op->is_armed) {
        return;
    }
    if (file) {
        IO_STATUS_BLOCK io_status;
        NtCancelIoFileEx(file, us_internal_pipe_op_iosb(op), &io_status);
        /* The pipe driver cancels before that returns. Should something layered on it not,
         * it still has the block to write to. */
        if (us_internal_pipe_op_iosb(op)->Status == (NTSTATUS) STATUS_PENDING) {
            return;
        }
    }
    if (NtCancelWaitCompletionPacket(op->packet, TRUE) == STATUS_SUCCESS) {
        op->is_armed = 0;
        us_internal_iocp_op_finished(req);
    }
}

static HANDLE us_internal_pipe_scratch_event(struct us_loop_t *loop) {
    if (!loop->scratch_event) {
        loop->scratch_event = CreateEventW(NULL, TRUE, FALSE, NULL);
        if (!loop->scratch_event) {
            BUN_PANIC("Could not create an event");
        }
    }
    return loop->scratch_event;
}

enum {
    LIBUS_PIPE_TYPE_UNKNOWN = 0,
    LIBUS_PIPE_TYPE_BYTES,
    /* Every write is a message, which a reader can tell from the next. */
    LIBUS_PIPE_TYPE_MESSAGES,
};

/* FILE_PIPE_LOCAL_INFORMATION */
struct us_internal_pipe_local_information_t {
    ULONG type, configuration, maximum_instances, current_instances, inbound_quota, read_data_available;
    ULONG outbound_quota, write_quota_available, state, end;
};

static int us_internal_pipe_query(HANDLE pipe, struct us_internal_pipe_local_information_t *information) {
    IO_STATUS_BLOCK io_status;
    return NtQueryInformationFile(pipe, &io_status, information, sizeof(*information), LIBUS_FILE_PIPE_LOCAL_INFORMATION) == STATUS_SUCCESS;
}

static int us_internal_pipe_type(HANDLE pipe) {
    struct us_internal_pipe_local_information_t information;
    return us_internal_pipe_query(pipe, &information) && information.type == LIBUS_FILE_PIPE_MESSAGE_TYPE ? LIBUS_PIPE_TYPE_MESSAGES : LIBUS_PIPE_TYPE_BYTES;
}

/* Pipe ends from outside
 *
 * An inherited handle can be synchronous, which cannot be found out without risking what it means: every call
 * on such a handle waits for the one before it, in whichever process that is, and a thread that waits like that
 * cannot be cancelled. So a thread of its own makes the calls: the reads, the writes, and what there is to ask.
 * It works for overlapped handles as well.
 *
 * The thread waits in a read of zero bytes, so that nothing is taken from a pipe nobody reads from here.
 * Then it takes no more than the last read here asked for: who wants only so much leaves the rest to the others.
 * While it does, other processes that share a synchronous handle block in most calls on it (on older Windows a child that inherits
 * stdin hangs at startup), which is why losing interest in reading has to get the thread out of there.
 * So has something to write, which goes first. */

enum {
    LIBUS_PIPE_THREAD_PARK = 0,
    LIBUS_PIPE_THREAD_READ = 1,
    /* Nobody wants the rest of a write either. */
    LIBUS_PIPE_THREAD_EXIT = 2,
};

struct us_internal_pipe_thread_t {
    /* The loop's side and the thread. */
    LONG refs;
    /* Each side writes one of the LONGs below and then looks at what the other wrote, which takes __ATOMIC_SEQ_CST. */
    LONG command;
    /* A LIBUS_PIPE_THREAD_READ command has no answer yet. Each gets one, even if LIBUS_PIPE_THREAD_PARK came after it. */
    LONG owes_read;
    /* How much to take from the pipe once there is something. 0: only tell. Written while `owes_read` is 0. */
    ULONG read_length;
    /* How much of `write_buffer` there is to write. 0 again once `write_status` has the answer. */
    LONG write_length;
    LONG is_reading, is_writing;
    /* The loop's side is cancelling. That call does not return while the thread it interrupted is in its next blocking
     * call, on this handle or any other, so the thread starts nothing. */
    LONG is_interrupted;
    /* A handle of the thread's own, which it closes. Whoever has the other one can close it at any time: the value is not
     * used here, and that close is not the one of the last handle, which blocks while a read is parked on the pipe. */
    HANDLE pipe;
    /* Auto-reset. One of the above was changed. */
    HANDLE wake;
    /* The event of the block's read operation: the answer is in `status`, `length` and `buffer`. */
    HANDLE read_done;
    /* The event of the block's write operation. */
    HANDLE write_done;
    HANDLE io_event;
    /* One for each direction, so that NtCancelIoFileEx can name the read or the write. */
    IO_STATUS_BLOCK read_io_status, write_io_status;
    NTSTATUS status;
    ULONG length;
    NTSTATUS write_status;
    char *write_buffer;
    ULONG write_capacity;
    /* LIBUS_PIPE_TYPE_UNKNOWN before the first write. */
    LONG type;
    char buffer[LIBUS_PIPE_CHUNK];
};

/* `crt_descriptor` is -1, or the descriptor of the C runtime that the handle belongs to. */
static void us_internal_pipe_close(HANDLE handle, int crt_descriptor) {
    if (crt_descriptor >= 0) {
        Bun__closeOSFHandle(crt_descriptor);
    } else {
        NtClose(handle);
    }
}

static void us_internal_pipe_thread_unref(struct us_internal_pipe_thread_t *thread) {
    if (__atomic_sub_fetch(&thread->refs, 1, __ATOMIC_ACQ_REL) == 0) {
        if (thread->pipe) NtClose(thread->pipe);
        if (thread->wake) NtClose(thread->wake);
        if (thread->read_done) NtClose(thread->read_done);
        if (thread->write_done) NtClose(thread->write_done);
        if (thread->io_event) NtClose(thread->io_event);
        if (thread->write_buffer) HeapFree(GetProcessHeap(), 0, thread->write_buffer);
        HeapFree(GetProcessHeap(), 0, thread);
    }
}

static NTSTATUS us_internal_pipe_thread_read(struct us_internal_pipe_thread_t *thread, void *buffer, ULONG length, ULONG *length_read) {
    IO_STATUS_BLOCK *io_status = &thread->read_io_status;
    __atomic_store_n(&thread->is_reading, 1, __ATOMIC_SEQ_CST);
    if (__atomic_load_n(&thread->command, __ATOMIC_SEQ_CST) != LIBUS_PIPE_THREAD_READ || __atomic_load_n(&thread->write_length, __ATOMIC_SEQ_CST) || __atomic_load_n(&thread->is_interrupted, __ATOMIC_SEQ_CST)) {
        __atomic_store_n(&thread->is_reading, 0, __ATOMIC_SEQ_CST);
        return STATUS_CANCELLED;
    }
    NTSTATUS status = NtReadFile(thread->pipe, thread->io_event, NULL, NULL, io_status, buffer, length, NULL, NULL);
    if (status == (NTSTATUS) STATUS_PENDING) {
        NtWaitForSingleObject(thread->io_event, FALSE, NULL);
        status = io_status->Status;
    }
    __atomic_store_n(&thread->is_reading, 0, __ATOMIC_SEQ_CST);
    /* Part of a message, on an end that reads by the message. */
    if (status == STATUS_BUFFER_OVERFLOW) {
        status = STATUS_SUCCESS;
    }
    *length_read = status == STATUS_SUCCESS ? (ULONG) io_status->Information : 0;
    return status;
}

/* FILE_PIPE_INFORMATION */
struct us_internal_pipe_information_t {
    ULONG read_mode, completion_mode;
};

static NTSTATUS us_internal_pipe_query_information(HANDLE pipe, struct us_internal_pipe_information_t *information) {
    IO_STATUS_BLOCK io_status;
    return NtQueryInformationFile(pipe, &io_status, information, sizeof(*information), LIBUS_FILE_PIPE_INFORMATION);
}

/* Only a pipe has empty messages. From anything else nothing is the end: a socket whose peer is done has that to say
 * as often as it is asked. Its device type is that of a named pipe too, so this asks what only a pipe can answer. */
static int us_internal_pipe_thread_has_messages(struct us_internal_pipe_thread_t *thread) {
    struct us_internal_pipe_information_t information;
    return us_internal_pipe_query_information(thread->pipe, &information) == STATUS_SUCCESS;
}

/* Takes PIPE_NOWAIT back, for everybody who has this end. libuv does that to every pipe it is given. */
static NTSTATUS us_internal_pipe_thread_make_writes_wait(struct us_internal_pipe_thread_t *thread) {
    struct us_internal_pipe_information_t information;
    NTSTATUS status = us_internal_pipe_query_information(thread->pipe, &information);
    if (status == STATUS_SUCCESS) {
        IO_STATUS_BLOCK io_status;
        information.completion_mode = LIBUS_FILE_PIPE_QUEUE_OPERATION;
        status = NtSetInformationFile(thread->pipe, &io_status, &information, sizeof(information), LIBUS_FILE_PIPE_INFORMATION);
    }
    return status;
}

static void us_internal_pipe_thread_write(struct us_internal_pipe_thread_t *thread) {
    IO_STATUS_BLOCK *io_status = &thread->write_io_status;
    const ULONG length = (ULONG) __atomic_load_n(&thread->write_length, __ATOMIC_SEQ_CST);
    NTSTATUS status = STATUS_SUCCESS;
    if (!__atomic_load_n(&thread->type, __ATOMIC_SEQ_CST)) {
        __atomic_store_n(&thread->type, us_internal_pipe_type(thread->pipe), __ATOMIC_SEQ_CST);
    }
    for (ULONG written = 0; written < length;) {
        __atomic_store_n(&thread->is_writing, 1, __ATOMIC_SEQ_CST);
        if (__atomic_load_n(&thread->command, __ATOMIC_SEQ_CST) == LIBUS_PIPE_THREAD_EXIT) {
            __atomic_store_n(&thread->is_writing, 0, __ATOMIC_SEQ_CST);
            status = STATUS_CANCELLED;
            break;
        }
        if (__atomic_load_n(&thread->is_interrupted, __ATOMIC_SEQ_CST)) {
            __atomic_store_n(&thread->is_writing, 0, __ATOMIC_SEQ_CST);
            NtWaitForSingleObject(thread->wake, FALSE, NULL);
            continue;
        }
        status = NtWriteFile(thread->pipe, thread->io_event, NULL, NULL, io_status, thread->write_buffer + written, length - written, NULL, NULL);
        if (status == (NTSTATUS) STATUS_PENDING) {
            NtWaitForSingleObject(thread->io_event, FALSE, NULL);
            status = io_status->Status;
        }
        __atomic_store_n(&thread->is_writing, 0, __ATOMIC_SEQ_CST);
        if (status != STATUS_SUCCESS) {
            break;
        }
        written += (ULONG) io_status->Information;
        /* An end in the mode that does not wait takes a write that fits at once, or nothing of it. One that is larger
         * than the pipe never fits, and nothing tells when a smaller one would. */
        if (!io_status->Information && (status = us_internal_pipe_thread_make_writes_wait(thread)) != STATUS_SUCCESS) {
            break;
        }
    }
    thread->write_status = status;
    __atomic_store_n(&thread->write_length, 0, __ATOMIC_SEQ_CST);
    SetEvent(thread->write_done);
}

static DWORD WINAPI us_internal_pipe_thread_main(void *arg) {
    struct us_internal_pipe_thread_t *thread = arg;
    for (;;) {
        if (__atomic_load_n(&thread->is_interrupted, __ATOMIC_SEQ_CST)) {
            NtWaitForSingleObject(thread->wake, FALSE, NULL);
            continue;
        }
        if (__atomic_load_n(&thread->write_length, __ATOMIC_SEQ_CST)) {
            us_internal_pipe_thread_write(thread);
            continue;
        }
        if (__atomic_load_n(&thread->command, __ATOMIC_SEQ_CST) == LIBUS_PIPE_THREAD_EXIT) {
            break;
        }
        if (!__atomic_load_n(&thread->owes_read, __ATOMIC_SEQ_CST)) {
            NtWaitForSingleObject(thread->wake, FALSE, NULL);
            continue;
        }
        NTSTATUS status;
        ULONG length = 0;
        for (;;) {
            status = us_internal_pipe_thread_read(thread, &us_internal_pipe_nothing, 0, &length);
            if (status == STATUS_SUCCESS && thread->read_length) {
                /* Returns with what there is. That is nothing if somebody else took it, or it was an empty message. */
                status = us_internal_pipe_thread_read(thread, thread->buffer, thread->read_length, &length);
            }
            if (status == STATUS_PIPE_EMPTY) {
                /* In this mode nothing ever tells that data arrived. */
                LARGE_INTEGER ten_ms = { .QuadPart = -10 * LIBUS_100NS_PER_MS };
                NtWaitForSingleObject(thread->wake, FALSE, &ten_ms);
                continue;
            }
            if (status != STATUS_SUCCESS || length || !thread->read_length) {
                break;
            }
            if (!us_internal_pipe_thread_has_messages(thread)) {
                status = STATUS_END_OF_FILE;
                break;
            }
        }
        /* No answer after a cancel that made way for a write (the read starts again), nor once the thread is told to exit. */
        const LONG command = __atomic_load_n(&thread->command, __ATOMIC_SEQ_CST);
        if (command == LIBUS_PIPE_THREAD_PARK || (command == LIBUS_PIPE_THREAD_READ && status != STATUS_CANCELLED)) {
            thread->status = status;
            thread->length = length;
            __atomic_store_n(&thread->owes_read, 0, __ATOMIC_SEQ_CST);
            SetEvent(thread->read_done);
        }
    }
    /* Not left to the last reference: the peer reads the end of the stream once this handle is closed too. */
    NtClose(thread->pipe);
    thread->pipe = NULL;
    us_internal_pipe_thread_unref(thread);
    return 0;
}

static struct us_internal_pipe_thread_t *us_internal_pipe_thread_create(HANDLE pipe, HANDLE read_done, HANDLE write_done) {
    /* Not the loop thread's allocator: the thread can be the one to free it, and can outlive the loop. */
    struct us_internal_pipe_thread_t *thread = HeapAlloc(GetProcessHeap(), 0, sizeof(struct us_internal_pipe_thread_t));
    if (!thread) {
        return NULL;
    }
    memset(thread, 0, offsetof(struct us_internal_pipe_thread_t, buffer));
    thread->refs = 2;
    thread->wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    thread->io_event = CreateEventW(NULL, TRUE, FALSE, NULL);
    HANDLE handle = NULL;
    if (thread->wake && thread->io_event &&
        DuplicateHandle(GetCurrentProcess(), pipe, GetCurrentProcess(), &thread->pipe, 0, FALSE, DUPLICATE_SAME_ACCESS) &&
        DuplicateHandle(GetCurrentProcess(), read_done, GetCurrentProcess(), &thread->read_done, 0, FALSE, DUPLICATE_SAME_ACCESS) &&
        DuplicateHandle(GetCurrentProcess(), write_done, GetCurrentProcess(), &thread->write_done, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
        handle = CreateThread(NULL, LIBUS_HELPER_STACK_COMMIT, us_internal_pipe_thread_main, thread, 0, NULL);
    }
    if (!handle) {
        thread->refs = 1;
        us_internal_pipe_thread_unref(thread);
        return NULL;
    }
    /* Among threads that compute, a new thread waits for its turn: tenths of a second on a busy machine, for a read
     * that takes microseconds. This one never computes. */
    SetThreadPriority(handle, THREAD_PRIORITY_ABOVE_NORMAL);
    NtClose(handle);
    return thread;
}

/* Cancels the call that the thread is in, if that is one it would not start now. Returns whether there was one.
 * `is_interrupted` is set, so the thread gets no further than out of that call, and its handle is open. */
static int us_internal_pipe_thread_cancel(struct us_internal_pipe_thread_t *thread) {
    IO_STATUS_BLOCK *io_status = NULL;
    if (__atomic_load_n(&thread->is_reading, __ATOMIC_SEQ_CST)) {
        if (__atomic_load_n(&thread->command, __ATOMIC_SEQ_CST) != LIBUS_PIPE_THREAD_READ || __atomic_load_n(&thread->write_length, __ATOMIC_SEQ_CST)) {
            io_status = &thread->read_io_status;
        }
    } else if (__atomic_load_n(&thread->is_writing, __ATOMIC_SEQ_CST) && __atomic_load_n(&thread->command, __ATOMIC_SEQ_CST) == LIBUS_PIPE_THREAD_EXIT) {
        io_status = &thread->write_io_status;
    }
    if (!io_status) {
        return 0;
    }
    IO_STATUS_BLOCK cancel_status;
    NtCancelIoFileEx(thread->pipe, io_status, &cancel_status);
    return 1;
}

/* Whether the loop can read and write by itself. Besides a synchronous handle, the thread copes with an end that reads
 * by the message or does not wait (PIPE_NOWAIT). */
int us_internal_pipe_is_overlapped(HANDLE handle) {
    IO_STATUS_BLOCK io_status;
    ULONG mode;
    struct us_internal_pipe_information_t information;
    return NtQueryInformationFile(handle, &io_status, &mode, sizeof(mode), LIBUS_FILE_MODE_INFORMATION) == STATUS_SUCCESS
        && !(mode & (FILE_SYNCHRONOUS_IO_ALERT | FILE_SYNCHRONOUS_IO_NONALERT))
        && us_internal_pipe_query_information(handle, &information) == STATUS_SUCCESS
        && !information.read_mode && !information.completion_mode;
}

/* One end of a pipe */

enum {
    LIBUS_PIPE_OPEN = 0,
    /* The server has no instance free. The write operation is a wait for one. */
    LIBUS_PIPE_CONNECTING,
    /* Shut down, with the last write still queued. */
    LIBUS_PIPE_ENDING,
    /* The write operation completes when the peer has read everything. */
    LIBUS_PIPE_FLUSHING,
    /* Waiting for the peer to close its end or to fall silent. The write operation is the timer for that. */
    LIBUS_PIPE_LINGERING,
    /* The block closed the handle, or never got one. */
    LIBUS_PIPE_CLOSED,
};

struct us_internal_pipe_req_t {
    struct us_internal_poll_req_t req;
    HANDLE handle;
    /* -1, or the descriptor of the C runtime that the handle belongs to. */
    int crt_descriptor;
    unsigned char phase;

    /* A read of zero bytes completed, and nothing was read since. */
    unsigned char has_data;
    /* The owner wants no more: it reads the end of the stream, whatever the peer sends. */
    unsigned char read_is_shut_down;
    /* The handle was opened for one direction only. */
    unsigned char cannot_read, cannot_write;
    /* LIBUS_PIPE_TYPE_UNKNOWN before the first write. */
    unsigned char type;

    struct us_internal_pipe_op_t read;
    /* Why there is nothing more to read. STATUS_PIPE_BROKEN is the end of the stream. */
    NTSTATUS read_status;
    /* How much of what there is to read was there before the queued write was made. That is no answer to it and does
     * not wait for it, or an owner that writes again at every writable event would never get to read. */
    ULONG earlier_input;

    /* LIBUS_POLL_KIND_FOREIGN_PIPE. Stays until the block goes. */
    struct us_internal_pipe_thread_t *thread;
    /* How much of thread->buffer is yet to be read. */
    ULONG buffer_length, buffer_offset;
    /* How much the last read asked for. */
    ULONG read_length;
    /* The pause before the next attempt to get the thread out of a call, and how long it is. 0: the last attempt did. */
    struct us_internal_pipe_op_t retry;
    ULONG retry_ms;
    /* There is no next attempt: the loop is being freed. */
    unsigned char is_abandoned;

    struct us_internal_pipe_op_t write;
    /* Why nothing more can be written. */
    NTSTATUS write_status;
    /* The Win32 error behind it, if the reason is that the pipe could not be opened. */
    DWORD open_error;
    /* The queued write. The caller's buffer is only good for the duration of the call.
     * The thread has its own, which it may need for longer than there is a block. */
    char *staging;
    ULONG staging_capacity;
    /* How long the queued write is, and how much of it the caller was told is written. */
    ULONG queued_length, claimed_length;
    /* The last write left the owner with bytes to offer again. They are gone if the process ends, so the loop
     * counts them, whether or not it counts the owner: libuv counts a write like that. */
    unsigned char holds_loop;

    /* Signaled once the peer has been silent for long enough. */
    HANDLE eof_timer;

    /* LIBUS_PIPE_CONNECTING */
    WCHAR *name;
    void *wait_buffer;
};

static void us_internal_pipe_on_read_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op);
static void us_internal_pipe_on_write_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op);
static void us_internal_pipe_on_retry(struct us_loop_t *loop, struct us_internal_iocp_op_t *op);

static struct us_internal_pipe_req_t *us_internal_pipe_create(struct us_loop_t *loop, struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = us_xcalloc(1, sizeof(struct us_internal_pipe_req_t));
    us_internal_iocp_req_init(&pipe->req, loop, p);
    pipe->handle = (HANDLE) p->state.fd;
    pipe->crt_descriptor = -1;
    return pipe;
}

static int us_internal_pipe_has_queued_write(struct us_internal_pipe_req_t *pipe) {
    return pipe->write.is_armed && (pipe->phase == LIBUS_PIPE_OPEN || pipe->phase == LIBUS_PIPE_ENDING);
}

/* There is nothing more to read, and the owner can be told. That the peer is gone has also ended a queued write, and
 * what became of that comes first: the owner closes at the end of the stream, and would never learn it. */
static int us_internal_pipe_read_is_over(struct us_internal_pipe_req_t *pipe) {
    int peer_is_gone = pipe->read_status == STATUS_PIPE_BROKEN || pipe->read_status == STATUS_PIPE_DISCONNECTED;
    return pipe->read_status != STATUS_SUCCESS && !(peer_is_gone && us_internal_pipe_has_queued_write(pipe));
}

static int us_internal_pipe_has_input(struct us_internal_pipe_req_t *pipe) {
    return pipe->has_data || pipe->read_is_shut_down || us_internal_pipe_read_is_over(pipe) || pipe->buffer_offset < pipe->buffer_length;
}

/* The queued write is through, and the port has yet to tell. The system finishes a request in the thread that made it, ahead of
 * what that thread asks for next: this holds as soon as a call of ours has seen what the peer sent once it had the write.
 * The helper thread reports a write before it reads on. */
static int us_internal_pipe_write_is_through(struct us_internal_pipe_req_t *pipe) {
    return pipe->phase == LIBUS_PIPE_OPEN && pipe->write.is_armed && !pipe->thread && us_internal_pipe_op_iosb(&pipe->write)->Status != (NTSTATUS) STATUS_PENDING;
}

/* What the peer answers to a queued write waits until the owner has heard that the write is through. Where "would
 * block" means that the peer got nothing, no answer can come before the socket is writable again, and owners go by that. */
static int us_internal_pipe_is_readable(struct us_internal_pipe_req_t *pipe) {
    return us_internal_pipe_has_input(pipe) && (pipe->earlier_input || !us_internal_pipe_write_is_through(pipe));
}

static int us_internal_pipe_is_writable(struct us_internal_pipe_req_t *pipe) {
    return pipe->write_status != STATUS_SUCCESS || (pipe->phase == LIBUS_PIPE_OPEN && !pipe->write.is_armed);
}

/* A pipe cannot be half closed: its stream ends when the peer's handle is closed, and then nothing can be written
 * either. That is what epoll reports for a unix socket as EPOLLHUP, asked or not, and what closes a socket
 * that allows half-open or has stopped reading. */
static int us_internal_pipe_is_hung_up(struct us_internal_pipe_req_t *pipe) {
    return us_internal_pipe_read_is_over(pipe) && pipe->buffer_offset == pipe->buffer_length &&
        us_internal_poll_type(pipe->req.owner) != POLL_TYPE_FILE_POLL;
}

/* The silence starts now. */
static void us_internal_pipe_start_eof_timer(struct us_internal_pipe_req_t *pipe) {
    LARGE_INTEGER due = { .QuadPart = -LIBUS_PIPE_EOF_TIMEOUT_MS * LIBUS_100NS_PER_MS };
    SetWaitableTimer(pipe->eof_timer, &due, 0, NULL, NULL, FALSE);
    if (!pipe->write.is_armed) {
        us_internal_pipe_op_arm(&pipe->req, &pipe->write, pipe->eof_timer);
    }
}

/* NULL if the system is out of something. */
static struct us_internal_pipe_thread_t *us_internal_pipe_thread_get(struct us_internal_pipe_req_t *pipe) {
    if (!pipe->thread &&
        us_internal_pipe_op_init(&pipe->read, us_internal_pipe_on_read_complete) == 0 &&
        us_internal_pipe_op_init(&pipe->write, us_internal_pipe_on_write_complete) == 0) {
        pipe->thread = us_internal_pipe_thread_create(pipe->handle, pipe->read.event, pipe->write.event);
    }
    return pipe->thread;
}

/* Gets the thread out of a blocking call. The caller has already changed what the thread checks before it starts the next one. */
static void us_internal_pipe_interrupt_thread(struct us_internal_pipe_req_t *pipe) {
    struct us_internal_pipe_thread_t *thread = pipe->thread;
    /* A cancel finds nothing while the thread is on its way into the kernel, so it takes more than one. */
    int attempts = pipe->retry_ms ? 8 : 2000;
    __atomic_store_n(&thread->is_interrupted, 1, __ATOMIC_SEQ_CST);
    while (us_internal_pipe_thread_cancel(thread) && --attempts) {
        SwitchToThread();
    }
    __atomic_store_n(&thread->is_interrupted, 0, __ATOMIC_SEQ_CST);
    SetEvent(thread->wake);
    if (attempts) {
        pipe->retry_ms = 0;
        us_internal_pipe_op_cancel(&pipe->req, &pipe->retry, NULL);
        return;
    }
    /* It keeps finding nothing while the call waits behind one of another process. Nothing tells when that is over, and
     * from then on the thread is in the way of whoever shares the handle. So look again, without holding up the loop. */
    if (pipe->is_abandoned || pipe->retry.is_armed || us_internal_pipe_op_init_as(&pipe->retry, 1, us_internal_pipe_on_retry) != 0) {
        return;
    }
    pipe->retry_ms = !pipe->retry_ms ? 1 : pipe->retry_ms < LIBUS_PIPE_RETRY_MAX_MS ? pipe->retry_ms * 2 : LIBUS_PIPE_RETRY_MAX_MS;
    LARGE_INTEGER due = { .QuadPart = -(LONGLONG) pipe->retry_ms * LIBUS_100NS_PER_MS };
    SetWaitableTimer(pipe->retry.event, &due, 0, NULL, NULL, FALSE);
    if (us_internal_pipe_op_arm(&pipe->req, &pipe->retry, pipe->retry.event) != 0) {
        pipe->retry_ms = 0;
    }
}

static void us_internal_pipe_on_retry(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) ((char *) op - offsetof(struct us_internal_pipe_req_t, retry.op));
    us_internal_iocp_op_finished(&pipe->req);
    pipe->retry.is_armed = 0;
    us_internal_pipe_interrupt_thread(pipe);
    us_internal_iocp_req_free_if_unused(&pipe->req);
}

/* Asks to be told when there is something to read, unless that is known already. */
static void us_internal_pipe_arm_read(struct us_internal_pipe_req_t *pipe) {
    if (pipe->read.is_armed || pipe->read_status != STATUS_SUCCESS || us_internal_pipe_has_input(pipe) || pipe->cannot_read || pipe->phase == LIBUS_PIPE_CONNECTING) {
        return;
    }

    if (pipe->req.kind == LIBUS_POLL_KIND_FOREIGN_PIPE) {
        struct us_internal_pipe_thread_t *thread = us_internal_pipe_thread_get(pipe);
        if (!thread) {
            pipe->read_status = STATUS_INSUFFICIENT_RESOURCES;
            return;
        }
        ResetEvent(pipe->read.event);
        if (us_internal_pipe_op_arm(&pipe->req, &pipe->read, pipe->read.event) != 0) {
            pipe->read_status = STATUS_INSUFFICIENT_RESOURCES;
            return;
        }
        thread->read_length = pipe->read_length;
        __atomic_store_n(&thread->command, LIBUS_PIPE_THREAD_READ, __ATOMIC_SEQ_CST);
        __atomic_store_n(&thread->owes_read, 1, __ATOMIC_SEQ_CST);
        SetEvent(thread->wake);
        if (pipe->phase == LIBUS_PIPE_LINGERING) {
            us_internal_pipe_start_eof_timer(pipe);
        }
        return;
    }

    if (us_internal_pipe_op_init(&pipe->read, us_internal_pipe_on_read_complete) != 0) {
        pipe->read_status = STATUS_INSUFFICIENT_RESOURCES;
        return;
    }

    IO_STATUS_BLOCK *io_status = us_internal_pipe_op_iosb(&pipe->read);
    io_status->Status = STATUS_PENDING;
    NTSTATUS status = NtReadFile(pipe->handle, pipe->read.event, NULL, NULL, io_status, &us_internal_pipe_nothing, 0, NULL, NULL);
    if (status == (NTSTATUS) STATUS_PENDING) {
        if (us_internal_pipe_op_arm_or_cancel(&pipe->req, &pipe->read, pipe->handle) != 0) {
            pipe->read_status = STATUS_INSUFFICIENT_RESOURCES;
        } else if (pipe->phase == LIBUS_PIPE_LINGERING) {
            us_internal_pipe_start_eof_timer(pipe);
        }
    } else if (status == STATUS_SUCCESS) {
        pipe->has_data = 1;
    } else {
        pipe->read_status = status;
    }
}

static void us_internal_pipe_close_handle(struct us_internal_pipe_req_t *pipe) {
    if (pipe->phase != LIBUS_PIPE_CLOSED) {
        pipe->phase = LIBUS_PIPE_CLOSED;
        us_internal_pipe_close(pipe->handle, pipe->crt_descriptor);
    }
}

static void us_internal_pipe_on_read_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) ((char *) op - offsetof(struct us_internal_pipe_req_t, read.op));
    us_internal_iocp_op_finished(&pipe->req);
    pipe->read.is_armed = 0;

    struct us_poll_t *p = pipe->req.owner;
    if (!p) {
        us_internal_iocp_req_free_if_unused(&pipe->req);
        return;
    }

    if (pipe->read_status == STATUS_SUCCESS) {
        NTSTATUS status;
        if (pipe->thread) {
            status = pipe->thread->status;
            pipe->buffer_offset = 0;
            pipe->buffer_length = pipe->thread->length;
            pipe->has_data = status == STATUS_SUCCESS && !pipe->buffer_length;
        } else {
            status = us_internal_pipe_op_iosb(&pipe->read)->Status;
            pipe->has_data = status == STATUS_SUCCESS;
        }
        if (status != STATUS_SUCCESS && status != STATUS_CANCELLED) {
            pipe->read_status = status;
        }
    }

    if (us_internal_pipe_is_readable(pipe)) {
        us_internal_pipe_ready(&pipe->req);
    } else {
        us_internal_iocp_queue_update(&pipe->req);
    }
}

static int us_internal_pipe_fail(NTSTATUS status) {
    SetLastError(RtlNtStatusToDosError(status));
    return -1;
}

static int us_internal_pipe_would_block(void) {
    SetLastError(WSAEWOULDBLOCK);
    return -1;
}

static int us_internal_pipe_read_ended(struct us_internal_pipe_req_t *pipe) {
    if (!us_internal_pipe_read_is_over(pipe)) {
        return us_internal_pipe_would_block();
    }
    /* The peer left without what it was sent. A unix socket reads a reset then, not the end of the stream. */
    if (pipe->write_status != STATUS_SUCCESS) {
        return us_internal_pipe_fail(pipe->write_status);
    }
    if (pipe->read_status == STATUS_PIPE_BROKEN || pipe->read_status == STATUS_END_OF_FILE) {
        return 0;
    }
    return us_internal_pipe_fail(pipe->read_status);
}

/* How much there is to read, as PeekNamedPipe() asks. No bound if the pipe does not tell. */
static ULONG us_internal_pipe_available(struct us_loop_t *loop, struct us_internal_pipe_req_t *pipe) {
    /* FILE_PIPE_PEEK_BUFFER without the data */
    struct {
        ULONG state;
        ULONG available;
        ULONG messages;
        ULONG message_length;
    } peek;
    HANDLE event = us_internal_pipe_scratch_event(loop);
    IO_STATUS_BLOCK io_status;
    NTSTATUS status = NtFsControlFile(pipe->handle, event, NULL, NULL, &io_status, LIBUS_FSCTL_PIPE_PEEK, NULL, 0, &peek, sizeof(peek));
    if (status == (NTSTATUS) STATUS_PENDING) {
        NtWaitForSingleObject(event, FALSE, NULL);
        status = io_status.Status;
    }
    return status == STATUS_SUCCESS || status == STATUS_BUFFER_OVERFLOW ? peek.available : ULONG_MAX;
}

int us_internal_pipe_read(struct us_loop_t *loop, struct us_poll_t *p, void *buffer, int length) {
    if (!p->state.req && us_internal_pipe_start(loop, p) != 0) {
        return -1;
    }
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) p->state.req;

    if (pipe->read_is_shut_down) {
        return 0;
    }
    if (pipe->buffer_offset < pipe->buffer_length) {
        ULONG available = pipe->buffer_length - pipe->buffer_offset;
        if ((ULONG) length > available) {
            length = (int) available;
        }
        memcpy(buffer, pipe->thread->buffer + pipe->buffer_offset, length);
        pipe->buffer_offset += length;
        us_internal_iocp_queue_update(&pipe->req);
        return length;
    }

    if (pipe->req.kind == LIBUS_POLL_KIND_FOREIGN_PIPE) {
        if (pipe->read_status != STATUS_SUCCESS) {
            return us_internal_pipe_read_ended(pipe);
        }
        pipe->read_length = (ULONG) length < LIBUS_PIPE_CHUNK ? (ULONG) length : LIBUS_PIPE_CHUNK;
        pipe->has_data = 0;
        /* The thread takes what arrives, so it starts once nothing is left to run: whoever was given the last of the
         * data may be the next to read the handle, in a call of their own, or start a child that is. */
        us_internal_iocp_queue_update(&pipe->req);
        return us_internal_pipe_would_block();
    }

    /* The read that finds nothing is also the one that reports when there is something. */
    us_internal_pipe_arm_read(pipe);
    if (pipe->read_status != STATUS_SUCCESS) {
        return us_internal_pipe_read_ended(pipe);
    }
    if (!pipe->has_data) {
        /* It may have found something that the port has yet to tell. */
        IO_STATUS_BLOCK *found = us_internal_pipe_op_iosb(&pipe->read);
        if (!pipe->read.is_armed || found->Status != STATUS_SUCCESS) {
            return us_internal_pipe_would_block();
        }
        found->Status = STATUS_CANCELLED;
    }

    if (pipe->phase == LIBUS_PIPE_OPEN && pipe->write.is_armed) {
        ULONG no_answer = pipe->earlier_input;
        if (!no_answer) {
            /* First the count, then the look at the write: what gets read was there while the write was not through. */
            no_answer = us_internal_pipe_available(loop, pipe);
            if (us_internal_pipe_write_is_through(pipe)) {
                pipe->has_data = 1;
                return us_internal_pipe_would_block();
            }
        }
        if (no_answer < (ULONG) length) {
            length = (int) no_answer;
        }
    }

    pipe->has_data = 0;
    us_internal_iocp_queue_update(&pipe->req);

    HANDLE event = us_internal_pipe_scratch_event(loop);
    IO_STATUS_BLOCK io_status;
    NTSTATUS status = NtReadFile(pipe->handle, event, NULL, NULL, &io_status, buffer, length, NULL, NULL);
    if (status == (NTSTATUS) STATUS_PENDING) {
        /* What completed the read of zero bytes was an empty message, or somebody else got the data.
         * The cancel can lose to data that arrives right now, and then the read has it. */
        IO_STATUS_BLOCK cancel_status;
        NtCancelIoFileEx(pipe->handle, &io_status, &cancel_status);
        NtWaitForSingleObject(event, FALSE, NULL);
        status = io_status.Status;
    }
    if (status == STATUS_SUCCESS || status == STATUS_BUFFER_OVERFLOW) {
        ULONG taken = (ULONG) io_status.Information;
        pipe->earlier_input -= taken < pipe->earlier_input ? taken : pipe->earlier_input;
        return taken ? (int) taken : us_internal_pipe_would_block();
    }
    if (status == STATUS_CANCELLED) {
        return us_internal_pipe_would_block();
    }
    pipe->read_status = status;
    return us_internal_pipe_read_ended(pipe);
}

/* Where the next byte to write is: at `offset` in iov[i]. */
struct us_internal_pipe_cursor_t {
    const struct us_iovec_t *iov;
    int count;
    int i;
    size_t offset;
};

/* The next bytes that lie together, at most `max` of them. NULL at the end. */
static const char *us_internal_pipe_cursor_next(struct us_internal_pipe_cursor_t *cursor, size_t max, size_t *length) {
    while (cursor->i < cursor->count && cursor->offset == cursor->iov[cursor->i].iov_len) {
        cursor->i++;
        cursor->offset = 0;
    }
    if (cursor->i == cursor->count || !max) {
        return NULL;
    }
    const char *bytes = (const char *) cursor->iov[cursor->i].iov_base + cursor->offset;
    size_t left = cursor->iov[cursor->i].iov_len - cursor->offset;
    *length = left < max ? left : max;
    cursor->offset += *length;
    return bytes;
}

/* How much there is at and after the cursor, or `max` if that is less. */
static ULONG us_internal_pipe_cursor_left(struct us_internal_pipe_cursor_t cursor, ULONG max) {
    ULONG total = 0;
    size_t length;
    while (us_internal_pipe_cursor_next(&cursor, max - total, &length)) {
        total += (ULONG) length;
    }
    return total;
}

static void us_internal_pipe_cursor_copy(struct us_internal_pipe_cursor_t *cursor, char *to, ULONG total) {
    const char *bytes;
    size_t length;
    while ((bytes = us_internal_pipe_cursor_next(cursor, total, &length))) {
        memcpy(to, bytes, length);
        to += length;
        total -= (ULONG) length;
    }
}

/* The queued write is through. Moves past as much of it as the caller offers again, and returns how much that is.
 * -1 if the caller offers other bytes: the peer has the queued ones, so these cannot be what follows. */
static int us_internal_pipe_claim_queued(struct us_internal_pipe_req_t *pipe, struct us_internal_pipe_cursor_t *cursor) {
    const char *queued = pipe->thread ? pipe->thread->write_buffer : pipe->staging;
    const ULONG claimed_before = pipe->claimed_length;
    const char *bytes;
    size_t length;
    while ((bytes = us_internal_pipe_cursor_next(cursor, pipe->queued_length - pipe->claimed_length, &length))) {
        if (memcmp(queued + pipe->claimed_length, bytes, length) != 0) {
            return -1;
        }
        pipe->claimed_length += (ULONG) length;
    }
    return (int) (pipe->claimed_length - claimed_before);
}

static void us_internal_pipe_hold_loop(struct us_internal_pipe_req_t *pipe) {
    if (!pipe->holds_loop) {
        pipe->holds_loop = 1;
        pipe->req.loop->num_polls++;
        pipe->req.loop->bun_polls++;
    }
}

/* The queued write no longer keeps the loop alive. Called before the owner is told that it can write, as it may write nothing. */
static void us_internal_pipe_release_loop(struct us_internal_pipe_req_t *pipe) {
    if (pipe->holds_loop) {
        pipe->holds_loop = 0;
        pipe->req.loop->num_polls--;
        pipe->req.loop->bun_polls--;
    }
}

/* Has the thread write the next `length` bytes. 0, or the reason there is no write queued. */
static NTSTATUS us_internal_pipe_thread_queue_write(struct us_internal_pipe_req_t *pipe, struct us_internal_pipe_cursor_t *cursor, ULONG length) {
    struct us_internal_pipe_thread_t *thread = us_internal_pipe_thread_get(pipe);
    if (!thread) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    if (length > thread->write_capacity || (length <= LIBUS_PIPE_CHUNK && thread->write_capacity > LIBUS_PIPE_CHUNK)) {
        if (thread->write_buffer) HeapFree(GetProcessHeap(), 0, thread->write_buffer);
        thread->write_capacity = length > LIBUS_PIPE_CHUNK ? length : LIBUS_PIPE_CHUNK;
        thread->write_buffer = HeapAlloc(GetProcessHeap(), 0, thread->write_capacity);
        if (!thread->write_buffer) {
            thread->write_capacity = 0;
            return STATUS_INSUFFICIENT_RESOURCES;
        }
    }
    ResetEvent(pipe->write.event);
    if (us_internal_pipe_op_arm(&pipe->req, &pipe->write, pipe->write.event) != 0) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    us_internal_pipe_cursor_copy(cursor, thread->write_buffer, length);
    __atomic_store_n(&thread->write_length, (LONG) length, __ATOMIC_SEQ_CST);
    us_internal_pipe_interrupt_thread(pipe);
    return STATUS_SUCCESS;
}

/* A large write is rare. */
static void us_internal_pipe_trim_staging(struct us_internal_pipe_req_t *pipe) {
    if (pipe->staging_capacity > LIBUS_PIPE_CHUNK) {
        us_free(pipe->staging);
        pipe->staging = NULL;
        pipe->staging_capacity = 0;
    }
}

/* Writes the next `length` bytes, or leaves them queued. 0, or the reason that not all of them will be written. */
static NTSTATUS us_internal_pipe_start_write(struct us_internal_pipe_req_t *pipe, struct us_internal_pipe_cursor_t *cursor, ULONG length) {
    if (us_internal_pipe_op_init(&pipe->write, us_internal_pipe_on_write_complete) != 0) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    if (length > pipe->staging_capacity) {
        ULONG capacity = 4096;
        while (capacity < length) capacity *= 2;
        us_free(pipe->staging);
        pipe->staging = us_xmalloc(capacity);
        pipe->staging_capacity = capacity;
    }
    us_internal_pipe_cursor_copy(cursor, pipe->staging, length);
    pipe->earlier_input = pipe->has_data ? us_internal_pipe_available(pipe->req.loop, pipe) : 0;
    IO_STATUS_BLOCK *io_status = us_internal_pipe_op_iosb(&pipe->write);
    io_status->Status = STATUS_PENDING;
    NTSTATUS status = NtWriteFile(pipe->handle, pipe->write.event, NULL, NULL, io_status, pipe->staging, length, NULL, NULL);
    if (status == (NTSTATUS) STATUS_PENDING) {
        if (us_internal_pipe_op_arm_or_cancel(&pipe->req, &pipe->write, pipe->handle) == 0) {
            return STATUS_SUCCESS;
        }
        /* How much the peer read before the cancel is not known, unless the write got through first. */
        status = io_status->Status == STATUS_SUCCESS ? STATUS_SUCCESS : STATUS_INSUFFICIENT_RESOURCES;
    }
    us_internal_pipe_trim_staging(pipe);
    return status;
}

int us_internal_pipe_writev(struct us_loop_t *loop, struct us_poll_t *p, const struct us_iovec_t *iov, int count) {
    if (!p->state.req && us_internal_pipe_start(loop, p) != 0) {
        return -1;
    }
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) p->state.req;

    if (pipe->write_status != STATUS_SUCCESS) {
        return us_internal_pipe_fail(pipe->write_status);
    }
    if (pipe->cannot_write || pipe->phase > LIBUS_PIPE_CONNECTING) {
        return us_internal_pipe_fail(STATUS_PIPE_CLOSING);
    }
    if (pipe->write.is_armed) {
        return us_internal_pipe_would_block();
    }

    const int is_foreign = pipe->req.kind == LIBUS_POLL_KIND_FOREIGN_PIPE;
    if (!pipe->type) {
        /* The thread asks at its first write. */
        pipe->type = (unsigned char) (!is_foreign ? us_internal_pipe_type(pipe->handle) : pipe->thread ? __atomic_load_n(&pipe->thread->type, __ATOMIC_SEQ_CST) : LIBUS_PIPE_TYPE_UNKNOWN);
    }
    struct us_internal_pipe_cursor_t cursor = { iov, count, 0, 0 };
    const int is_empty = !us_internal_pipe_cursor_left(cursor, 1);
    int written = us_internal_pipe_claim_queued(pipe, &cursor);
    if (written < 0) {
        pipe->write_status = STATUS_INVALID_PARAMETER;
        return us_internal_pipe_fail(pipe->write_status);
    }
    /* What could be a message goes out in one piece. Nothing is left here while a part of the queued write is unclaimed. */
    const ULONG length = us_internal_pipe_cursor_left(cursor, pipe->type == LIBUS_PIPE_TYPE_BYTES ? LIBUS_PIPE_MAX_WRITE : (ULONG) (INT_MAX - written));
    if (length) {
        NTSTATUS status = is_foreign ? us_internal_pipe_thread_queue_write(pipe, &cursor, length) : us_internal_pipe_start_write(pipe, &cursor, length);
        if (status != STATUS_SUCCESS) {
            pipe->write_status = status;
            if (pipe->cannot_read) {
                /* No read is there to find that the peer is gone. */
                pipe->read_status = status;
                us_internal_iocp_queue_update(&pipe->req);
            }
            return us_internal_pipe_fail(status);
        }
        pipe->claimed_length = 0;
        pipe->queued_length = pipe->write.is_armed ? length : 0;
        written += pipe->write.is_armed ? 0 : (int) length;
    } else if (pipe->claimed_length == pipe->queued_length) {
        us_internal_pipe_trim_staging(pipe);
    }
    if (pipe->write.is_armed || us_internal_pipe_cursor_left(cursor, 1)) {
        us_internal_pipe_hold_loop(pipe);
    } else {
        us_internal_pipe_release_loop(pipe);
    }
    return written || is_empty ? written : us_internal_pipe_would_block();
}

int us_internal_pipe_write(struct us_loop_t *loop, struct us_poll_t *p, const void *buffer, int length) {
    struct us_iovec_t iov = { (void *) buffer, (size_t) length };
    return us_internal_pipe_writev(loop, p, &iov, 1);
}

/* NULL unless `p` is an end of a pipe and has a block. */
static struct us_internal_pipe_req_t *us_internal_pipe_of(struct us_poll_t *p) {
    int is_end = p->state.kind == LIBUS_POLL_KIND_PIPE || p->state.kind == LIBUS_POLL_KIND_FOREIGN_PIPE;
    return is_end ? (struct us_internal_pipe_req_t *) p->state.req : NULL;
}

void us_internal_pipe_disown_write(struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = us_internal_pipe_of(p);
    if (pipe) {
        pipe->queued_length = pipe->claimed_length = 0;
    }
}

static void us_internal_pipe_quiesce(struct us_internal_pipe_req_t *pipe);

/* Closes our end for good and has the owner read the end of the stream. No write is queued. */
static void us_internal_pipe_end_of_stream(struct us_internal_pipe_req_t *pipe) {
    us_internal_pipe_quiesce(pipe);
    us_internal_pipe_close_handle(pipe);
    if (pipe->read_status == STATUS_SUCCESS) {
        pipe->read_status = STATUS_PIPE_BROKEN;
    }
    pipe->has_data = 0;
    us_internal_iocp_queue_ready(&pipe->req);
}

/* Pipes cannot be closed in one direction: the peer reads the end of the stream when our handle is closed, which
 * also throws away what it sent and we have not read. So, as libuv does: wait until the peer has read everything,
 * then give it until it has been silent for a while, then close. Runs when the write operation is free.
 * On a handle that may be synchronous the first wait would keep the thread from reading, so there is only the second. */
static void us_internal_pipe_continue_shutdown(struct us_internal_pipe_req_t *pipe) {
    if (pipe->phase == LIBUS_PIPE_ENDING) {
        pipe->phase = LIBUS_PIPE_FLUSHING;
        if (pipe->write_status == STATUS_SUCCESS && us_internal_pipe_op_init(&pipe->write, us_internal_pipe_on_write_complete) == 0 &&
            pipe->req.kind == LIBUS_POLL_KIND_PIPE) {
            IO_STATUS_BLOCK *io_status = us_internal_pipe_op_iosb(&pipe->write);
            io_status->Status = STATUS_PENDING;
            NTSTATUS status = NtFsControlFile(pipe->handle, pipe->write.event, NULL, NULL, io_status, LIBUS_FSCTL_PIPE_FLUSH, NULL, 0, NULL, 0);
            if (status == (NTSTATUS) STATUS_PENDING && us_internal_pipe_op_arm_or_cancel(&pipe->req, &pipe->write, pipe->handle) == 0) {
                return;
            }
        }
    }
    if (pipe->phase == LIBUS_PIPE_FLUSHING) {
        if (!pipe->cannot_read && !pipe->read_is_shut_down && pipe->read_status == STATUS_SUCCESS && pipe->write.packet &&
            (pipe->eof_timer = CreateWaitableTimerW(NULL, TRUE, NULL))) {
            pipe->phase = LIBUS_PIPE_LINGERING;
            if (pipe->read.is_armed) {
                us_internal_pipe_start_eof_timer(pipe);
            }
            return;
        }
        us_internal_pipe_end_of_stream(pipe);
    }
}

void us_internal_pipe_shutdown_read(struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) p->state.req;
    if (pipe) {
        pipe->read_is_shut_down = 1;
        us_internal_iocp_queue_update(&pipe->req);
    }
}

void us_internal_pipe_shutdown(struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) p->state.req;
    if (!pipe || pipe->phase != LIBUS_PIPE_OPEN) {
        return;
    }
    pipe->phase = LIBUS_PIPE_ENDING;
    if (!pipe->write.is_armed) {
        us_internal_pipe_continue_shutdown(pipe);
    }
}

/* Connecting */

static HANDLE us_internal_pipe_driver;

static BOOL CALLBACK us_internal_pipe_open_driver(PINIT_ONCE once, PVOID parameter, PVOID *context) {
    UNICODE_STRING name;
    RtlInitUnicodeString(&name, L"\\Device\\NamedPipe\\");
    OBJECT_ATTRIBUTES attributes;
    InitializeObjectAttributes(&attributes, &name, 0, NULL, NULL);
    IO_STATUS_BLOCK io_status;
    if (NtOpenFile(&us_internal_pipe_driver, FILE_READ_ATTRIBUTES | SYNCHRONIZE, &attributes, &io_status, FILE_SHARE_READ | FILE_SHARE_WRITE, 0) != STATUS_SUCCESS) {
        us_internal_pipe_driver = NULL;
    }
    return TRUE;
}

/* The root directory of the pipe driver, opened for overlapped use. NULL if that failed. */
static HANDLE us_internal_pipe_driver_handle(void) {
    static INIT_ONCE once = INIT_ONCE_STATIC_INIT;
    InitOnceExecuteOnce(&once, us_internal_pipe_open_driver, NULL, NULL);
    return us_internal_pipe_driver;
}

static const WCHAR us_internal_pipe_prefix[] = L"\\\\.\\pipe\\";
#define LIBUS_PIPE_PREFIX_LENGTH (sizeof(us_internal_pipe_prefix) / sizeof(WCHAR) - 1)

int us_internal_is_pipe_name(const char *path, size_t length) {
#define IS_SEPARATOR(c) ((c) == '\\' || (c) == '/')
    return length > LIBUS_PIPE_PREFIX_LENGTH && IS_SEPARATOR(path[0]) && IS_SEPARATOR(path[1]) && (path[2] == '.' || path[2] == '?') && IS_SEPARATOR(path[3]) &&
        (path[4] | 0x20) == 'p' && (path[5] | 0x20) == 'i' && (path[6] | 0x20) == 'p' && (path[7] | 0x20) == 'e' && IS_SEPARATOR(path[8]);
#undef IS_SEPARATOR
}

/* `\\.\pipe\` and what follows it in `path`, which us_internal_is_pipe_name accepted. NULL: LIBUS_ERR has the reason. */
static WCHAR *us_internal_pipe_wide_name(const char *path, size_t length) {
    if (memchr(path, 0, length)) {
        SetLastError(WSAEINVAL);
        return NULL;
    }
    int wide_length = MultiByteToWideChar(CP_UTF8, 0, path, (int) length, NULL, 0);
    if (wide_length <= 0) {
        SetLastError(ERROR_INVALID_NAME);
        return NULL;
    }
    WCHAR *name = us_xmalloc((wide_length + 1) * sizeof(WCHAR));
    MultiByteToWideChar(CP_UTF8, 0, path, (int) length, name, wide_length);
    name[wide_length] = 0;
    memcpy(name, us_internal_pipe_prefix, LIBUS_PIPE_PREFIX_LENGTH * sizeof(WCHAR));
    /* Separators are backslashes, and several count as one. That is what Win32 makes of them, and the wait for a free
     * instance is given the name as it is here. */
    WCHAR *end = name + LIBUS_PIPE_PREFIX_LENGTH;
    for (const WCHAR *component = end, *c = end;; c++) {
        int is_over = !*c;
        if (!is_over && *c != L'\\' && *c != L'/') {
            *end++ = *c;
            continue;
        }
        if ((end != component && wcsspn(component, L". ") >= (size_t) (end - component)) || (is_over && end == name + LIBUS_PIPE_PREFIX_LENGTH)) {
            us_free(name);
            SetLastError(WSAEINVAL);
            return NULL;
        }
        if (is_over) {
            *end = 0;
            return name;
        }
        if (end != component) {
            *end++ = L'\\';
        }
        component = end;
    }
}

/* 0, or the Win32 error. */
static DWORD us_internal_pipe_open(struct us_internal_pipe_req_t *pipe) {
    /* A server can offer one direction only, through the kind of pipe or its access control list. The
     * attribute rights are what asking about the pipe and changing its mode take. */
    static const DWORD access[3] = { GENERIC_READ | GENERIC_WRITE, GENERIC_READ | FILE_WRITE_ATTRIBUTES, GENERIC_WRITE | FILE_READ_ATTRIBUTES };
    DWORD error = 0;
    for (int i = 0; i < 3; i++) {
        HANDLE handle = CreateFileW(pipe->name, access[i], 0, NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);
        if (handle != INVALID_HANDLE_VALUE) {
            pipe->handle = handle;
            pipe->cannot_write = i == 1;
            pipe->cannot_read = i == 2;
            if (pipe->req.owner) {
                pipe->req.owner->state.fd = (LIBUS_SOCKET_DESCRIPTOR) handle;
            }
            return 0;
        }
        error = GetLastError();
        if (error != ERROR_ACCESS_DENIED) {
            break;
        }
    }
    return error;
}

typedef struct {
    LARGE_INTEGER Timeout;
    ULONG NameLength;
    BOOLEAN TimeoutSpecified;
    WCHAR Name[1];
} FILE_PIPE_WAIT_FOR_BUFFER_;

/* Opens the pipe, or leaves the block waiting for its next chance to. */
static void us_internal_pipe_try_connect(struct us_internal_pipe_req_t *pipe) {
    DWORD error = pipe->name ? us_internal_pipe_open(pipe) : WSAEINVAL;
    if (error == 0) {
        pipe->phase = LIBUS_PIPE_OPEN;
        return;
    }
    pipe->phase = LIBUS_PIPE_CLOSED;
    pipe->write_status = pipe->read_status = STATUS_PIPE_NOT_AVAILABLE;
    pipe->open_error = error;
    HANDLE driver;
    if (error != ERROR_PIPE_BUSY || !(driver = us_internal_pipe_driver_handle()) ||
        us_internal_pipe_op_init(&pipe->write, us_internal_pipe_on_write_complete) != 0) {
        return;
    }

    const WCHAR *name = pipe->name + LIBUS_PIPE_PREFIX_LENGTH;
    ULONG name_size = (ULONG) (wcslen(name) * sizeof(WCHAR));
    ULONG size = offsetof(FILE_PIPE_WAIT_FOR_BUFFER_, Name) + name_size;
    if (!pipe->wait_buffer) {
        pipe->wait_buffer = us_xmalloc(size);
    }
    FILE_PIPE_WAIT_FOR_BUFFER_ *wait = pipe->wait_buffer;
    wait->Timeout.QuadPart = -(LONGLONG) LIBUS_PIPE_BUSY_TIMEOUT_MS * LIBUS_100NS_PER_MS;
    wait->NameLength = name_size;
    wait->TimeoutSpecified = TRUE;
    memcpy(wait->Name, name, name_size);

    IO_STATUS_BLOCK *io_status = us_internal_pipe_op_iosb(&pipe->write);
    io_status->Status = STATUS_PENDING;
    NTSTATUS status = NtFsControlFile(driver, pipe->write.event, NULL, NULL, io_status, LIBUS_FSCTL_PIPE_WAIT, wait, size, NULL, 0);
    if (!NT_SUCCESS(status)) {
        pipe->open_error = RtlNtStatusToDosError(status);
    } else if (us_internal_pipe_op_arm_or_cancel(&pipe->req, &pipe->write, driver) == 0) {
        pipe->phase = LIBUS_PIPE_CONNECTING;
        pipe->write_status = pipe->read_status = STATUS_SUCCESS;
        pipe->open_error = 0;
    }
}

/* `p` becomes writable when the pipe is open, and reports an error if it cannot be (us_internal_pipe_error). */
void us_internal_pipe_connect(struct us_loop_t *loop, struct us_poll_t *p, const char *path, size_t length) {
    p->state.kind = LIBUS_POLL_KIND_PIPE;
    p->state.fd = (LIBUS_SOCKET_DESCRIPTOR) INVALID_HANDLE_VALUE;
    struct us_internal_pipe_req_t *pipe = us_internal_pipe_create(loop, p);
    pipe->name = us_internal_pipe_wide_name(path, length);
    us_internal_pipe_try_connect(pipe);
}

/* The Win32 error that keeps the pipe from being written to, 0 if there is none. */
int us_internal_pipe_error(struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) p->state.req;
    if (!pipe || p->state.kind == LIBUS_POLL_KIND_PIPE_LISTENER || pipe->write_status == STATUS_SUCCESS) {
        return 0;
    }
    return (int) (pipe->open_error ? pipe->open_error : RtlNtStatusToDosError(pipe->write_status));
}

static void us_internal_pipe_on_write_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) ((char *) op - offsetof(struct us_internal_pipe_req_t, write.op));
    us_internal_iocp_op_finished(&pipe->req);
    pipe->write.is_armed = 0;
    us_internal_pipe_release_loop(pipe);

    struct us_poll_t *p = pipe->req.owner;
    if (!p) {
        us_internal_iocp_req_free_if_unused(&pipe->req);
        return;
    }

    NTSTATUS status = pipe->thread ? pipe->thread->write_status : us_internal_pipe_op_iosb(&pipe->write)->Status;
    switch (pipe->phase) {
    case LIBUS_PIPE_CONNECTING:
        if (status == STATUS_SUCCESS) {
            /* Everybody who waited was told, so the instance may be taken again. */
            us_internal_pipe_try_connect(pipe);
            if (pipe->phase == LIBUS_PIPE_CONNECTING) {
                return;
            }
        } else {
            pipe->phase = LIBUS_PIPE_CLOSED;
            pipe->write_status = pipe->read_status = status;
        }
        break;
    case LIBUS_PIPE_OPEN:
    case LIBUS_PIPE_ENDING:
        if (status != STATUS_SUCCESS) {
            pipe->write_status = status;
        } else if (pipe->phase == LIBUS_PIPE_ENDING) {
            us_internal_pipe_continue_shutdown(pipe);
            return;
        }
        break;
    case LIBUS_PIPE_FLUSHING:
        us_internal_pipe_continue_shutdown(pipe);
        return;
    case LIBUS_PIPE_LINGERING:
        if (WaitForSingleObject(pipe->eof_timer, 0) != WAIT_OBJECT_0) {
            /* This expiry was on its way when the timer was set anew. */
            us_internal_pipe_op_arm(&pipe->req, &pipe->write, pipe->eof_timer);
            return;
        }
        /* Nothing is timed while the owner does not read. A read that has completed broke the silence: its packet
         * is behind this one if the loop was kept from running, and reading on sets the timer anew. */
        if (pipe->read.is_armed && (pipe->thread ? __atomic_load_n(&pipe->thread->owes_read, __ATOMIC_SEQ_CST) : us_internal_pipe_op_iosb(&pipe->read)->Status == (NTSTATUS) STATUS_PENDING)) {
            us_internal_pipe_end_of_stream(pipe);
        }
        return;
    default:
        return;
    }

    us_internal_iocp_queue_update(&pipe->req);
    us_internal_iocp_dispatch(loop, p, pipe->write_status != STATUS_SUCCESS, 0, LIBUS_SOCKET_WRITABLE);
}

/* Servers
 *
 * There is no such thing as a listening pipe. A client connects to an instance of the pipe that has nobody at its
 * other end yet, and that instance is the connection. The instances that wait are the backlog. */

struct us_internal_pipe_instance_t {
    struct us_internal_pipe_op_t listen;
    struct us_internal_pipe_listener_req_t *listener;
    /* NULL if there is none. */
    HANDLE handle;
    unsigned char is_connected;
};

struct us_internal_pipe_listener_req_t {
    struct us_internal_poll_req_t req;
    WCHAR *name;
    /* Since the last us_internal_pipe_update, of which there is one per turn of the loop. */
    int num_accepted;
    struct us_internal_pipe_instance_t instances[LIBUS_PIPE_INSTANCES];
};

static void us_internal_pipe_on_listen_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op);

static int us_internal_pipe_listen_succeeded(NTSTATUS status) {
    /* A client that has left again may have written something first. */
    return status == STATUS_SUCCESS || status == STATUS_PIPE_CONNECTED || status == STATUS_PIPE_CLOSING;
}

/* On failure the reason is in LIBUS_ERR. */
static int us_internal_pipe_instance_open(struct us_internal_pipe_instance_t *instance, int is_first) {
    struct us_internal_pipe_listener_req_t *listener = instance->listener;
    if (us_internal_pipe_op_init(&instance->listen, us_internal_pipe_on_listen_complete) != 0) {
        return -1;
    }
    HANDLE handle = CreateNamedPipeW(listener->name,
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (is_first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0),
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, PIPE_UNLIMITED_INSTANCES, LIBUS_PIPE_CHUNK,
        LIBUS_PIPE_CHUNK, 0, NULL);
    if (handle == INVALID_HANDLE_VALUE) {
        return -1;
    }
    IO_STATUS_BLOCK *io_status = us_internal_pipe_op_iosb(&instance->listen);
    io_status->Status = STATUS_PENDING;
    NTSTATUS status = NtFsControlFile(handle, instance->listen.event, NULL, NULL, io_status, LIBUS_FSCTL_PIPE_LISTEN, NULL, 0, NULL, 0);
    if (status == (NTSTATUS) STATUS_PENDING) {
        if (us_internal_pipe_op_arm_or_cancel(&listener->req, &instance->listen, handle) != 0) {
            NtClose(handle);
            SetLastError(ERROR_NOT_ENOUGH_MEMORY);
            return -1;
        }
    } else if (us_internal_pipe_listen_succeeded(status)) {
        instance->is_connected = 1;
    } else {
        NtClose(handle);
        SetLastError(RtlNtStatusToDosError(status));
        return -1;
    }
    instance->handle = handle;
    return 0;
}

static void us_internal_pipe_on_listen_complete(struct us_loop_t *loop, struct us_internal_iocp_op_t *op) {
    struct us_internal_pipe_instance_t *instance = (struct us_internal_pipe_instance_t *) ((char *) op - offsetof(struct us_internal_pipe_instance_t, listen.op));
    struct us_internal_pipe_listener_req_t *listener = instance->listener;
    us_internal_iocp_op_finished(&listener->req);
    instance->listen.is_armed = 0;

    struct us_poll_t *p = listener->req.owner;
    if (!p) {
        us_internal_iocp_req_free_if_unused(&listener->req);
        return;
    }
    if (!us_internal_pipe_listen_succeeded(us_internal_pipe_op_iosb(&instance->listen)->Status)) {
        NtClose(instance->handle);
        instance->handle = NULL;
        us_internal_pipe_instance_open(instance, 0);
        if (!instance->is_connected) {
            return;
        }
    }
    instance->is_connected = 1;
    us_internal_iocp_queue_update(&listener->req);
    us_internal_iocp_dispatch(loop, p, 0, 0, LIBUS_SOCKET_READABLE);
}

/* `p` becomes readable when us_internal_pipe_accept has something to return. On failure the reason is in LIBUS_ERR. */
int us_internal_pipe_listen(struct us_loop_t *loop, struct us_poll_t *p, const char *path, size_t length) {
    WCHAR *name = us_internal_pipe_wide_name(path, length);
    if (!name) {
        return -1;
    }
    p->state.kind = LIBUS_POLL_KIND_PIPE_LISTENER;
    p->state.fd = (LIBUS_SOCKET_DESCRIPTOR) INVALID_HANDLE_VALUE;
    struct us_internal_pipe_listener_req_t *listener = us_xcalloc(1, sizeof(struct us_internal_pipe_listener_req_t));
    us_internal_iocp_req_init(&listener->req, loop, p);
    listener->name = name;
    for (int i = 0; i < LIBUS_PIPE_INSTANCES; i++) {
        listener->instances[i].listener = listener;
        if (us_internal_pipe_instance_open(&listener->instances[i], i == 0) != 0 && i == 0) {
            DWORD error = GetLastError();
            us_internal_pipe_detach(&listener->req, 1);
            /* ERROR_ACCESS_DENIED: the name has an instance already. */
            SetLastError(error == ERROR_ACCESS_DENIED ? WSAEADDRINUSE : error == ERROR_PATH_NOT_FOUND || error == ERROR_INVALID_NAME ? WSAEACCES : error);
            return -1;
        }
    }
    return 0;
}

/* The server's end of the next connection, for a LIBUS_POLL_KIND_PIPE poll. INVALID_HANDLE_VALUE if there is none. */
HANDLE us_internal_pipe_accept(struct us_poll_t *p) {
    struct us_internal_pipe_listener_req_t *listener = (struct us_internal_pipe_listener_req_t *) p->state.req;
    HANDLE accepted = INVALID_HANDLE_VALUE;
    /* A new instance can have its client at once, and the caller goes on for as long as there is a connection. */
    int may_accept = listener->num_accepted < LIBUS_PIPE_INSTANCES;
    for (int i = 0; i < LIBUS_PIPE_INSTANCES; i++) {
        struct us_internal_pipe_instance_t *instance = &listener->instances[i];
        if (instance->is_connected && may_accept) {
            accepted = instance->handle;
            instance->handle = NULL;
            instance->is_connected = 0;
            listener->num_accepted++;
            may_accept = 0;
        }
        if (!instance->handle && !instance->listen.is_armed) {
            us_internal_pipe_instance_open(instance, 0);
        }
    }
    if (accepted == INVALID_HANDLE_VALUE) {
        SetLastError(WSAEWOULDBLOCK);
    }
    return accepted;
}

/* What iocp.c calls */

int us_internal_pipe_start(struct us_loop_t *loop, struct us_poll_t *p) {
    /* A handle that is not open fails here, as a descriptor that is not open fails epoll_ctl. */
    if (p->state.kind == LIBUS_POLL_KIND_PIPE_LISTENER ||
        (GetFileType((HANDLE) p->state.fd) == FILE_TYPE_UNKNOWN && GetLastError() != NO_ERROR)) {
        SetLastError(ERROR_INVALID_HANDLE);
        return -1;
    }
    us_internal_pipe_create(loop, p);
    return 0;
}

void us_internal_pipe_update(struct us_internal_poll_req_t *req) {
    int events = us_poll_events(req->owner);

    if (req->kind == LIBUS_POLL_KIND_PIPE_LISTENER) {
        struct us_internal_pipe_listener_req_t *listener = (struct us_internal_pipe_listener_req_t *) req;
        listener->num_accepted = 0;
        for (int i = 0; i < LIBUS_PIPE_INSTANCES && (events & LIBUS_SOCKET_READABLE); i++) {
            if (listener->instances[i].is_connected) {
                us_internal_iocp_queue_ready(req);
                break;
            }
        }
        return;
    }

    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) req;
    if (events & LIBUS_SOCKET_READABLE) {
        us_internal_pipe_arm_read(pipe);
        if (us_internal_pipe_is_readable(pipe)) {
            us_internal_iocp_queue_ready(req);
        }
    } else if (pipe->thread && pipe->read.is_armed && __atomic_load_n(&pipe->thread->command, __ATOMIC_SEQ_CST) == LIBUS_PIPE_THREAD_READ) {
        __atomic_store_n(&pipe->thread->command, LIBUS_PIPE_THREAD_PARK, __ATOMIC_SEQ_CST);
        us_internal_pipe_interrupt_thread(pipe);
    } else if (us_internal_pipe_is_hung_up(pipe) && !req->hangup_was_reported) {
        us_internal_iocp_queue_ready(req);
    }
    if ((events & LIBUS_SOCKET_WRITABLE) && us_internal_pipe_is_writable(pipe)) {
        us_internal_iocp_queue_ready(req);
    }
}

void us_internal_pipe_ready(struct us_internal_poll_req_t *req) {
    /* Asked again after the handler: readiness is level-triggered. */
    us_internal_iocp_queue_update(req);
    if (req->kind == LIBUS_POLL_KIND_PIPE_LISTENER) {
        us_internal_iocp_dispatch(req->loop, req->owner, 0, 0, LIBUS_SOCKET_READABLE);
        return;
    }
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) req;
    int events = (us_internal_pipe_is_readable(pipe) ? LIBUS_SOCKET_READABLE : 0) | (us_internal_pipe_is_writable(pipe) ? LIBUS_SOCKET_WRITABLE : 0);
    if (events & LIBUS_SOCKET_WRITABLE) {
        us_internal_pipe_release_loop(pipe);
    }
    int polled = us_poll_events(req->owner);
    int error = pipe->write_status != STATUS_SUCCESS && (polled & LIBUS_SOCKET_WRITABLE);
    int eof = 0;
    if (us_internal_pipe_is_hung_up(pipe) && ((polled & LIBUS_SOCKET_READABLE) || !req->hangup_was_reported)) {
        req->hangup_was_reported = 1;
        eof = LIBUS_POLL_HANGUP;
    }
    /* Counted as an operation, the block outlives the handler. */
    us_internal_iocp_op_started(req);
    us_internal_iocp_dispatch(req->loop, req->owner, error, eof, events);
    us_internal_iocp_op_finished(req);
    if (!req->owner) {
        us_internal_iocp_req_free_if_unused(req);
        return;
    }
    /* A pipe finds that its peer is gone when it asks for more. epoll reports that together with the last of the data, so
     * nothing comes between the two: the end of what a child wrote is seen before its exit. To ask takes nothing from a
     * pipe of ours, and the update has it to do anyway. */
    if (req->kind == LIBUS_POLL_KIND_PIPE && !eof && (events & us_poll_events(req->owner) & LIBUS_SOCKET_READABLE)) {
        us_internal_pipe_arm_read(pipe);
        if (us_internal_pipe_is_hung_up(pipe)) {
            us_internal_pipe_ready(req);
        }
    }
}

/* Takes back what is in flight. The caller of a queued write has not been told that it is written, and the peer has
 * read an unknown part of it, so nothing may follow it. */
static void us_internal_pipe_quiesce(struct us_internal_pipe_req_t *pipe) {
    HANDLE file = pipe->thread ? NULL : pipe->handle;
    if (pipe->thread) {
        __atomic_store_n(&pipe->thread->command, LIBUS_PIPE_THREAD_EXIT, __ATOMIC_SEQ_CST);
        us_internal_pipe_interrupt_thread(pipe);
        pipe->buffer_length = pipe->buffer_offset = 0;
    }
    us_internal_pipe_op_cancel(&pipe->req, &pipe->read, file);
    switch (pipe->phase) {
    case LIBUS_PIPE_CONNECTING:
        us_internal_pipe_op_cancel(&pipe->req, &pipe->write, us_internal_pipe_driver_handle());
        pipe->phase = LIBUS_PIPE_CLOSED;
        break;
    case LIBUS_PIPE_LINGERING:
        us_internal_pipe_op_cancel(&pipe->req, &pipe->write, NULL);
        break;
    case LIBUS_PIPE_CLOSED:
        break;
    default:
        us_internal_pipe_op_cancel(&pipe->req, &pipe->write, file);
        break;
    }
    us_internal_pipe_release_loop(pipe);
}

void us_internal_pipe_set_crt_descriptor(struct us_poll_t *p, int crt_descriptor) {
    ((struct us_internal_pipe_req_t *) p->state.req)->crt_descriptor = crt_descriptor;
}

int us_internal_pipe_get_crt_descriptor(struct us_poll_t *p) {
    struct us_internal_pipe_req_t *pipe = us_internal_pipe_of(p);
    return pipe ? pipe->crt_descriptor : -1;
}

void us_internal_pipe_detach(struct us_internal_poll_req_t *req, int close_handle) {
    req->owner->state.req = NULL;
    req->owner = NULL;

    if (req->kind == LIBUS_POLL_KIND_PIPE_LISTENER) {
        struct us_internal_pipe_listener_req_t *listener = (struct us_internal_pipe_listener_req_t *) req;
        for (int i = 0; i < LIBUS_PIPE_INSTANCES; i++) {
            struct us_internal_pipe_instance_t *instance = &listener->instances[i];
            if (instance->handle) {
                us_internal_pipe_op_cancel(req, &instance->listen, instance->handle);
                NtClose(instance->handle);
                instance->handle = NULL;
            }
        }
        us_internal_iocp_req_free_if_unused(req);
        return;
    }

    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) req;
    us_internal_pipe_quiesce(pipe);
    if (close_handle) {
        us_internal_pipe_close_handle(pipe);
    }
    us_internal_iocp_req_free_if_unused(req);
}

/* The loop goes away, so nothing of the block's may stay in flight. */
void us_internal_pipe_abandon(struct us_internal_poll_req_t *req) {
    if (req->kind != LIBUS_POLL_KIND_PIPE_LISTENER) {
        struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) req;
        pipe->is_abandoned = 1;
        us_internal_pipe_op_cancel(req, &pipe->retry, NULL);
    }
    if (req->owner) {
        us_internal_pipe_detach(req, 0);
    } else {
        us_internal_iocp_req_free_if_unused(req);
    }
}

void us_internal_pipe_destroy(struct us_internal_poll_req_t *req) {
    if (req->kind == LIBUS_POLL_KIND_PIPE_LISTENER) {
        struct us_internal_pipe_listener_req_t *listener = (struct us_internal_pipe_listener_req_t *) req;
        for (int i = 0; i < LIBUS_PIPE_INSTANCES; i++) {
            us_internal_pipe_op_destroy(&listener->instances[i].listen);
        }
        us_free(listener->name);
        return;
    }
    struct us_internal_pipe_req_t *pipe = (struct us_internal_pipe_req_t *) req;
    if (pipe->thread) us_internal_pipe_thread_unref(pipe->thread);
    us_internal_pipe_op_destroy(&pipe->read);
    us_internal_pipe_op_destroy(&pipe->write);
    us_internal_pipe_op_destroy(&pipe->retry);
    if (pipe->eof_timer) NtClose(pipe->eof_timer);
    us_free(pipe->staging);
    us_free(pipe->name);
    us_free(pipe->wait_buffer);
}

#endif
