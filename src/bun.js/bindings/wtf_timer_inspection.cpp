#include <pthread.h>
#include <time.h>
#include <assert.h>
#include <inttypes.h>
#include <stddef.h>
#include <stdio.h>

static uint64_t last_asap_update = 0;
static ssize_t generation = -1;

struct bun_timespec {
    ssize_t sec;
    ssize_t nsec;
};

extern uint64_t wtf_timer_main_tid;

extern "C" {
void WTFTimer__inspect_update(const void* timer, double seconds, bool repeat, const bun_timespec* ts)
{
    uint64_t tid;
    pthread_threadid_np(nullptr, &tid);
    if (wtf_timer_main_tid != tid && ts->sec == 1024) {
        fprintf(stderr, "update %zd from off main, tid %" PRIu64 "\n", ts->nsec, tid);
    }

    uint64_t now = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW);
    if (ts->sec == 1024) {
        if (generation != -1) {
            fprintf(stderr, "%zd never fired after %" PRIu64 " us\n", generation, (now - last_asap_update) / 1'000);
        }
        generation = ts->nsec;
    }

    if (seconds == 0.0 && !repeat) {
        last_asap_update = now;
    }
}

void WTFTimer__inspect_fire(const bun_timespec* ts)
{
    if (ts->sec == 1024) {
        // asap
        generation = -1;
        uint64_t now = clock_gettime_nsec_np(_CLOCK_MONOTONIC_RAW);
        uint64_t diff = now - last_asap_update;
        fprintf(stderr, "asap timer %zd fired after %" PRIu64 " us\n", ts->nsec, diff / 1'000);
    }
}
}
