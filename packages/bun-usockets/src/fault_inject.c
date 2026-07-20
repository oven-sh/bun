#include "internal/internal.h"
#include "internal/fault_inject.h"

#if defined(LIBUS_SOCKET_FAULT_INJECTION) && LIBUS_SOCKET_FAULT_INJECTION

#include <errno.h>
#include <string.h>

int us_fault_armed = 0;

struct us_fault_slot {
    struct us_fault_rule rule;
    int calls_seen;
    int fired;
};

/* Process-global so rules armed on the JS thread also affect the HTTP-client
 * thread (fetch) and any worker threads. Per-socket isolation is provided by
 * rule.target_fd instead. */
static struct us_fault_slot us_fault_state[US_FAULT_COUNT];

/* Guards every access to us_fault_state so a re-arm on the JS thread cannot
 * tear the rule (or its counters) out from under a faulting I/O thread. Only
 * taken once the lock-free us_fault_armed fast path in US_FAULT_CHECK has
 * passed, so the disarmed hot path never touches it. */
static zig_mutex_t us_fault_lock;

/* Caller must hold us_fault_lock. The release store pairs with the acquire
 * load in US_FAULT_CHECK; a reader that observes armed==1 then re-reads the
 * rule under the lock in us_fault_hit(), so it never sees a torn rule. */
static void us_fault_recompute_armed(void) {
    int any = 0;
    for (int i = 0; i < US_FAULT_COUNT; i++) {
        if (us_fault_state[i].rule.action != US_FAULT_NONE) {
            any = 1;
            break;
        }
    }
    __atomic_store_n(&us_fault_armed, any, __ATOMIC_RELEASE);
}

void us_fault_set(int sc, const struct us_fault_rule *rule) {
    if ((unsigned)sc >= US_FAULT_COUNT) return;
    Bun__lock(&us_fault_lock);
    us_fault_state[sc].rule = *rule;
    us_fault_state[sc].calls_seen = 0;
    us_fault_state[sc].fired = 0;
    us_fault_recompute_armed();
    Bun__unlock(&us_fault_lock);
}

void us_fault_clear(int sc) {
    if ((unsigned)sc >= US_FAULT_COUNT) return;
    Bun__lock(&us_fault_lock);
    us_fault_state[sc].rule.action = US_FAULT_NONE;
    us_fault_state[sc].calls_seen = 0;
    us_fault_state[sc].fired = 0;
    us_fault_recompute_armed();
    Bun__unlock(&us_fault_lock);
}

void us_fault_clear_all(void) {
    Bun__lock(&us_fault_lock);
    for (int i = 0; i < US_FAULT_COUNT; i++) {
        us_fault_state[i].rule.action = US_FAULT_NONE;
    }
    __atomic_store_n(&us_fault_armed, 0, __ATOMIC_RELEASE);
    Bun__unlock(&us_fault_lock);
}

int us_fault_hit(int sc, int fd, ssize_t *out, int *clamp) {
    if ((unsigned)sc >= US_FAULT_COUNT) return 0;
    Bun__lock(&us_fault_lock);
    struct us_fault_slot *slot = &us_fault_state[sc];
    /* Snapshot under the lock so the post-release switch below acts on one
     * coherent rule even if another thread swaps it right after we unlock.
     * Single lock/unlock pair: every exit funnels through the one release. */
    struct us_fault_rule rule = slot->rule;
    int fire = 0;
    if (rule.action != US_FAULT_NONE && (rule.target_fd < 0 || rule.target_fd == fd)) {
        int seen = slot->calls_seen++;
        if (seen >= rule.after_n_calls) {
            int f = slot->fired++;
            if (rule.repeat >= 0 && f >= rule.repeat) {
                slot->rule.action = US_FAULT_NONE;
                us_fault_recompute_armed();
            } else {
                fire = 1;
            }
        }
    }
    Bun__unlock(&us_fault_lock);
    if (!fire) return 0;
    switch (rule.action) {
        case US_FAULT_ERRNO:
#ifdef _WIN32
            WSASetLastError(rule.errno_value);
#endif
            errno = rule.errno_value;
            *out = -1;
            return 1;
        case US_FAULT_ZERO:
            *out = 0;
            return 1;
        case US_FAULT_SHORT:
            if (rule.clamp_bytes >= 0 && *clamp > rule.clamp_bytes) {
                *clamp = rule.clamp_bytes;
            }
            return 0;
        default:
            return 0;
    }
}

#endif /* LIBUS_SOCKET_FAULT_INJECTION */
