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
 * rule.target_fd instead. The release store on us_fault_armed in
 * us_fault_recompute_armed() pairs with the acquire load in US_FAULT_CHECK so
 * a reader observing armed==1 also sees the rule fields written before it.
 * calls_seen/fired are atomic counters so cross-thread firings preserve
 * after/repeat determinism. */
static struct us_fault_slot us_fault_state[US_FAULT_COUNT];

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
    us_fault_state[sc].rule = *rule;
    __atomic_store_n(&us_fault_state[sc].calls_seen, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&us_fault_state[sc].fired, 0, __ATOMIC_RELAXED);
    us_fault_recompute_armed();
}

void us_fault_clear(int sc) {
    if ((unsigned)sc >= US_FAULT_COUNT) return;
    __atomic_store_n(&us_fault_state[sc].rule.action, US_FAULT_NONE, __ATOMIC_RELAXED);
    __atomic_store_n(&us_fault_state[sc].calls_seen, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&us_fault_state[sc].fired, 0, __ATOMIC_RELAXED);
    us_fault_recompute_armed();
}

void us_fault_clear_all(void) {
    for (int i = 0; i < US_FAULT_COUNT; i++) {
        __atomic_store_n(&us_fault_state[i].rule.action, US_FAULT_NONE, __ATOMIC_RELAXED);
    }
    __atomic_store_n(&us_fault_armed, 0, __ATOMIC_RELEASE);
}

int us_fault_hit(int sc, int fd, ssize_t *out, int *clamp) {
    struct us_fault_slot *slot = &us_fault_state[sc];
    /* Snapshot the rule so a concurrent disarm cannot tear fields mid-switch. */
    struct us_fault_rule rule = slot->rule;
    if (rule.action == US_FAULT_NONE) return 0;
    if (rule.target_fd >= 0 && rule.target_fd != fd) return 0;
    int seen = __atomic_fetch_add(&slot->calls_seen, 1, __ATOMIC_RELAXED);
    if (seen < rule.after_n_calls) return 0;
    int f = __atomic_fetch_add(&slot->fired, 1, __ATOMIC_ACQ_REL);
    if (rule.repeat >= 0 && f >= rule.repeat) {
        __atomic_store_n(&slot->rule.action, US_FAULT_NONE, __ATOMIC_RELAXED);
        us_fault_recompute_armed();
        return 0;
    }
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
