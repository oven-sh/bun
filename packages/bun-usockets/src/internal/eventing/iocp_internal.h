/* What eventing/iocp.c and eventing/iocp_pipe.c share. Nothing else includes this. */
#ifndef IOCP_INTERNAL_H
#define IOCP_INTERNAL_H

#include "internal/internal.h"
#include <winternl.h>

#ifndef STATUS_SUCCESS
#define STATUS_SUCCESS ((NTSTATUS) 0x00000000L)
#endif
#ifndef STATUS_CANCELLED
#define STATUS_CANCELLED ((NTSTATUS) 0xC0000120L)
#endif
#ifndef STATUS_BUFFER_OVERFLOW
#define STATUS_BUFFER_OVERFLOW ((NTSTATUS) 0x80000005L)
#endif
#ifndef STATUS_END_OF_FILE
#define STATUS_END_OF_FILE ((NTSTATUS) 0xC0000011L)
#endif
#ifndef STATUS_INSUFFICIENT_RESOURCES
#define STATUS_INSUFFICIENT_RESOURCES ((NTSTATUS) 0xC000009AL)
#endif
/* Opening a pipe whose instances all have a client. */
#ifndef STATUS_PIPE_NOT_AVAILABLE
#define STATUS_PIPE_NOT_AVAILABLE ((NTSTATUS) 0xC00000ACL)
#endif
/* The server ended the connection with DisconnectNamedPipe(). What was not read yet is gone. */
#ifndef STATUS_PIPE_DISCONNECTED
#define STATUS_PIPE_DISCONNECTED ((NTSTATUS) 0xC00000B0L)
#endif
/* The peer closed its end: what a write gets, and a listen whose client has come and gone. */
#ifndef STATUS_PIPE_CLOSING
#define STATUS_PIPE_CLOSING ((NTSTATUS) 0xC00000B1L)
#endif
#ifndef STATUS_PIPE_CONNECTED
#define STATUS_PIPE_CONNECTED ((NTSTATUS) 0xC00000B2L)
#endif
/* Nothing to read on an end that somebody switched to PIPE_NOWAIT. */
#ifndef STATUS_PIPE_EMPTY
#define STATUS_PIPE_EMPTY ((NTSTATUS) 0xC00000D9L)
#endif
/* The peer closed its end and everything it wrote was read. */
#ifndef STATUS_PIPE_BROKEN
#define STATUS_PIPE_BROKEN ((NTSTATUS) 0xC000014BL)
#endif

/* to_cancel NULL: everything this process has pending on the file. */
NTSYSAPI NTSTATUS NTAPI NtCancelIoFileEx(HANDLE file, PIO_STATUS_BLOCK to_cancel, PIO_STATUS_BLOCK io_status);
NTSYSAPI NTSTATUS NTAPI NtReadFile(HANDLE file, HANDLE event, PIO_APC_ROUTINE apc_routine, PVOID apc_context,
    PIO_STATUS_BLOCK io_status, PVOID buffer, ULONG length, PLARGE_INTEGER offset, PULONG key);
NTSYSAPI NTSTATUS NTAPI NtWriteFile(HANDLE file, HANDLE event, PIO_APC_ROUTINE apc_routine, PVOID apc_context,
    PIO_STATUS_BLOCK io_status, PVOID buffer, ULONG length, PLARGE_INTEGER offset, PULONG key);
NTSYSAPI NTSTATUS NTAPI NtQueryInformationFile(HANDLE file, PIO_STATUS_BLOCK io_status, PVOID information, ULONG length, int information_class);
NTSYSAPI NTSTATUS NTAPI NtSetInformationFile(HANDLE file, PIO_STATUS_BLOCK io_status, PVOID information, ULONG length, int information_class);
NTSYSAPI NTSTATUS NTAPI NtFsControlFile(HANDLE file, HANDLE event, PIO_APC_ROUTINE apc_routine, PVOID apc_context,
    PIO_STATUS_BLOCK io_status, ULONG code, PVOID input, ULONG input_length, PVOID output, ULONG output_length);

/* A wait completion packet queues one packet on a port when a kernel object becomes signaled, or at once
 * if it already is. It can be associated again only after that packet was taken off the port. */
NTSYSAPI NTSTATUS NTAPI NtCreateWaitCompletionPacket(PHANDLE packet, ACCESS_MASK access, POBJECT_ATTRIBUTES attributes);
NTSYSAPI NTSTATUS NTAPI NtAssociateWaitCompletionPacket(HANDLE packet, HANDLE port, HANDLE target, PVOID key,
    PVOID context, NTSTATUS status, ULONG_PTR information, PBOOLEAN already_signaled);
/* STATUS_SUCCESS: no packet will come, one that was queued on the port included (with remove_queued).
 * Anything else: it was taken off the port already, or is being queued right now. */
NTSYSAPI NTSTATUS NTAPI NtCancelWaitCompletionPacket(HANDLE packet, BOOLEAN remove_queued);
#define LIBUS_WAIT_COMPLETION_PACKET_ALL_ACCESS 0x000F0001

/* The head of every request block. A block is freed once it has no owner, none of its operations is
 * in flight and it is on neither queue. */
struct us_internal_poll_req_t {
    /* NULL when nobody wants its events any more. */
    struct us_poll_t *owner;
    struct us_loop_t *loop;
    struct us_internal_poll_req_t *prev, *next;
    struct us_internal_poll_req_t *update_next;
    struct us_internal_poll_req_t *ready_next;
    unsigned char kind;
    unsigned char is_queued_for_update;
    unsigned char is_queued_as_ready;
    /* Operations of this block whose packet has not been dispatched. */
    unsigned char num_inflight_ops;
    /* A hangup stays true for good. An owner that does not read is told once per change of interest,
     * or a paused socket would spin the loop. */
    unsigned char hangup_was_reported;
};

void us_internal_iocp_req_init(struct us_internal_poll_req_t *req, struct us_loop_t *loop, struct us_poll_t *owner);
void us_internal_iocp_req_free_if_unused(struct us_internal_poll_req_t *req);
void us_internal_iocp_queue_update(struct us_internal_poll_req_t *req);
void us_internal_iocp_queue_ready(struct us_internal_poll_req_t *req);
int us_internal_pipe_error(struct us_poll_t *p);

#define LIBUS_100NS_PER_MS 10000

/* The kernel accepted an operation of `req`: exactly one packet naming it will reach its on_complete. */
static inline void us_internal_iocp_op_started(struct us_internal_poll_req_t *req) {
    req->num_inflight_ops++;
    req->loop->num_inflight_ops++;
}

/* First thing in every on_complete of a block's operation, and after a cancel that took the packet back. */
static inline void us_internal_iocp_op_finished(struct us_internal_poll_req_t *req) {
    req->num_inflight_ops--;
    req->loop->num_inflight_ops--;
}

/* Calls the poll's handler with the events it still polls for. It may stop, move or free the poll and
 * run the loop, so the caller can touch neither the poll nor its block afterwards. */
void us_internal_iocp_dispatch(struct us_loop_t *loop, struct us_poll_t *p, int error, int eof, int events);

/* eventing/iocp_pipe.c */
int us_internal_pipe_start(struct us_loop_t *loop, struct us_poll_t *p);
void us_internal_pipe_update(struct us_internal_poll_req_t *req);
void us_internal_pipe_ready(struct us_internal_poll_req_t *req);
void us_internal_pipe_shutdown_read(struct us_poll_t *p);
void us_internal_pipe_detach(struct us_internal_poll_req_t *req, int close_handle);
void us_internal_pipe_abandon(struct us_internal_poll_req_t *req);
void us_internal_pipe_destroy(struct us_internal_poll_req_t *req);

#endif // IOCP_INTERNAL_H
