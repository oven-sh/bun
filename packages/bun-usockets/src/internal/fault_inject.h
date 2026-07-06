/*
 * Fault injection for the bsd_* syscall wrappers, plus the one allocation
 * whose failure path is otherwise unreachable on an overcommitting kernel
 * (US_FAULT_SSL_LOOP_BUFFER).
 *
 * Compiled in only when LIBUS_SOCKET_FAULT_INJECTION is defined (controlled
 * by the `socketFaultInjection` Config field). When compiled out,
 * US_FAULT_CHECK() expands to a constant 0 and the optimizer drops every
 * reference. When compiled in but no rule is armed, the hot path is a single
 * acquire atomic load + predicted-not-taken branch.
 *
 * Rules are process-global so a rule armed from the JS thread also affects
 * the HTTP-client thread (fetch) and worker threads. Use rule.target_fd for
 * per-socket isolation.
 */
// clang-format off
#pragma once
#ifndef LIBUS_FAULT_INJECT_H
#define LIBUS_FAULT_INJECT_H

#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION

#ifdef _WIN32
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#else
#include <sys/types.h>
#endif

enum us_fault_syscall {
    US_FAULT_RECV,
    US_FAULT_SEND,
    US_FAULT_WRITEV,
    US_FAULT_SENDMSG,
    US_FAULT_RECVMSG,
    US_FAULT_CONNECT,
    US_FAULT_ACCEPT,
    /* Reserved: no bsd.c hooks yet, so the JS setter does not accept them. */
    US_FAULT_SOCKET,
    US_FAULT_CLOSE,
    US_FAULT_SHUTDOWN,
    /* Not a syscall: the per-loop TLS plaintext buffer allocated once by
     * us_internal_init_loop_ssl_data. Only US_FAULT_ERRNO applies — there is
     * no byte count to clamp and no zero return to fake. */
    US_FAULT_SSL_LOOP_BUFFER,
    US_FAULT_COUNT
};

enum us_fault_action {
    US_FAULT_NONE,
    /* return -1 and set errno = errno_value */
    US_FAULT_ERRNO,
    /* recv/send: clamp the length to clamp_bytes, then run the real syscall.
     * Other syscalls have no length to clamp; the JS setter rejects them. */
    US_FAULT_SHORT,
    /* recv/recvmsg: return 0 (peer closed); send/sendmsg/writev: return 0
     * (treated as backpressure). The JS setter rejects other syscalls. */
    US_FAULT_ZERO,
};

struct us_fault_rule {
    int action;
    int errno_value;
    int clamp_bytes;
    /* skip the first N matching calls before triggering */
    int after_n_calls;
    /* fire this many times then disarm; -1 = forever */
    int repeat;
    /* match only this fd; -1 = any */
    int target_fd;
};

#ifdef __cplusplus
extern "C" {
#endif

extern int us_fault_armed;

void us_fault_set(int syscall, const struct us_fault_rule *rule);
void us_fault_clear(int syscall);
void us_fault_clear_all(void);
int us_fault_hit(int syscall, int fd, ssize_t *out, int *clamp);

#ifdef __cplusplus
}
#endif

/* Hot-path macro. `out_lvalue` and `clamp_lvalue` must be lvalues. Returns 1
 * when the call should short-circuit with *out_lvalue. clamp_lvalue may be
 * shrunk in-place when the rule wants a partial read/write. */
#define US_FAULT_CHECK(sc, fd, out_lvalue, clamp_lvalue)                                                 \
    (__builtin_expect(__atomic_load_n(&us_fault_armed, __ATOMIC_ACQUIRE), 0)                             \
        && us_fault_hit((sc), (int)(fd), &(out_lvalue), &(clamp_lvalue)))

#else /* !LIBUS_SOCKET_FAULT_INJECTION */

#define US_FAULT_CHECK(sc, fd, out_lvalue, clamp_lvalue) 0

#endif
#endif /* LIBUS_FAULT_INJECT_H */
