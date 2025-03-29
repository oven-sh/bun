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

#include "libusockets.h"
#include "internal/internal.h"
#include <stdlib.h>
#include <time.h>

#if defined(LIBUS_USE_EPOLL) || defined(LIBUS_USE_KQUEUE)

void Bun__internal_dispatch_ready_poll(void* loop, void* poll);
// void Bun__internal_dispatch_ready_poll(void* loop, void* poll) {}

#ifndef WIN32
/* Cannot include this one on Windows */
#include <unistd.h>
#include <stdint.h>
#include <errno.h>
#include <string.h> // memset
#endif

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec* timeout);

/* Pointer tags are used to indicate a Bun pointer versus a uSockets pointer */
#define UNSET_BITS_49_UNTIL_64 0x0000FFFFFFFFFFFF
#define CLEAR_POINTER_TAG(p) ((void *) ((uintptr_t) (p) & UNSET_BITS_49_UNTIL_64))
#define LIKELY(cond) __builtin_expect((_Bool)(cond), 1)
#define UNLIKELY(cond) __builtin_expect((_Bool)(cond), 0)

#ifdef LIBUS_USE_EPOLL
#define GET_READY_POLL(loop, index) (struct us_poll_t *) loop->ready_polls[index].data.ptr
#define SET_READY_POLL(loop, index, poll) loop->ready_polls[index].data.ptr = (void*)poll
#else
#define GET_READY_POLL(loop, index) (struct us_poll_t *) loop->ready_polls[index].udata
#define SET_READY_POLL(loop, index, poll) loop->ready_polls[index].udata = (uint64_t)poll
#endif

/* Loop */
void us_loop_free(struct us_loop_t *loop) {
    us_internal_loop_data_free(loop);
    close(loop->fd);
    us_free(loop);
}

/* Poll */
struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    if (!fallthrough) {
        loop->num_polls++;
    }
    return CLEAR_POINTER_TAG(us_malloc(sizeof(struct us_poll_t) + ext_size));
}

/* Todo: this one should be us_internal_poll_free */
void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
    loop->num_polls--;
    us_free(p);
}

void *us_poll_ext(struct us_poll_t *p) {
    return p + 1;
}

/* Todo: why have us_poll_create AND us_poll_init!? libuv legacy! */
void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type) {
    p->state.fd = fd;
    p->state.poll_type = poll_type;
}

int us_poll_events(struct us_poll_t *p) {
    return ((p->state.poll_type & POLL_TYPE_POLLING_IN) ? LIBUS_SOCKET_READABLE : 0) | ((p->state.poll_type & POLL_TYPE_POLLING_OUT) ? LIBUS_SOCKET_WRITABLE : 0);
}

LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) {
    return p->state.fd;
}

/* Returns any of listen socket, socket, shut down socket or callback */
int us_internal_poll_type(struct us_poll_t *p) {
    return p->state.poll_type & POLL_TYPE_KIND_MASK;
}

/* Bug: doesn't really SET, rather read and change, so needs to be inited first! */
void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
    p->state.poll_type = poll_type | (p->state.poll_type & POLL_TYPE_POLLING_MASK);
}

/* Timer */
void *us_timer_ext(struct us_timer_t *timer) {
    return ((struct us_internal_callback_t *) timer) + 1;
}

struct us_loop_t *us_timer_loop(struct us_timer_t *t) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) t;

    return internal_cb->loop;
}


#if defined(LIBUS_USE_EPOLL) 

#include <sys/syscall.h>
#include <signal.h>
#include <errno.h>

static int has_epoll_pwait2 = -1;

#ifndef SYS_epoll_pwait2
// It's consistent on multiple architectures
// https://github.com/torvalds/linux/blob/9d1ddab261f3e2af7c384dc02238784ce0cf9f98/include/uapi/asm-generic/unistd.h#L795
// https://github.com/google/gvisor/blob/master/test/syscalls/linux/epoll.cc#L48C1-L50C7
#define SYS_epoll_pwait2 441
#endif

extern ssize_t sys_epoll_pwait2(int epfd, struct epoll_event* events, int maxevents,
                              const struct timespec* timeout, const sigset_t* sigmask);


static int bun_epoll_pwait2(int epfd, struct epoll_event *events, int maxevents, const struct timespec *timeout) {
    int ret;
    sigset_t mask;  
    sigemptyset(&mask);
  
    if (has_epoll_pwait2 != 0) {
        do {
            ret = sys_epoll_pwait2(epfd, events, maxevents, timeout, &mask);
        } while (ret == -EINTR);

        if (LIKELY(ret != -ENOSYS && ret != -EPERM && ret != -EOPNOTSUPP)) {
            return ret;
        }

        has_epoll_pwait2 = 0;
    }

    int timeoutMs = -1; 
    if (timeout) {
        timeoutMs = timeout->tv_sec * 1000 + timeout->tv_nsec / 1000000;
    }

    do {
        ret = epoll_pwait(epfd, events, maxevents, timeoutMs, &mask);
    } while (IS_EINTR(ret));

    return ret;
}

extern int Bun__isEpollPwait2SupportedOnLinuxKernel();

#endif

/* Loop */
struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size) {
    struct us_loop_t *loop = (struct us_loop_t *) us_calloc(1, sizeof(struct us_loop_t) + ext_size);
    loop->num_polls = 0;
    /* These could be accessed if we close a poll before starting the loop */
    loop->num_ready_polls = 0;
    loop->current_ready_poll = 0;

    loop->bun_polls = 0;

#ifdef LIBUS_USE_EPOLL
    loop->fd = epoll_create1(EPOLL_CLOEXEC);

    if (has_epoll_pwait2 == -1) {
        if (Bun__isEpollPwait2SupportedOnLinuxKernel() == 0) {
            has_epoll_pwait2 = 0;
        } 
    }

#else
    loop->fd = kqueue();
#endif

    us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb);
    return loop;
}

void us_loop_run(struct us_loop_t *loop) {
    us_loop_integrate(loop);

    /* While we have non-fallthrough polls we shouldn't fall through */
    while (loop->num_polls) {
        /* Emit pre callback */
        us_internal_loop_pre(loop);

        /* Fetch ready polls */
#ifdef LIBUS_USE_EPOLL
        loop->num_ready_polls = bun_epoll_pwait2(loop->fd, loop->ready_polls, 1024, NULL);
#else
        do {
            loop->num_ready_polls = kevent64(loop->fd, NULL, 0, loop->ready_polls, 1024, 0, NULL);
        } while (IS_EINTR(loop->num_ready_polls));
#endif

        /* Iterate ready polls, dispatching them by type */
        for (loop->current_ready_poll = 0; loop->current_ready_poll < loop->num_ready_polls; loop->current_ready_poll++) {
            struct us_poll_t *poll = GET_READY_POLL(loop, loop->current_ready_poll);
            /* Any ready poll marked with nullptr will be ignored */
            if (LIKELY(poll)) {
                if (CLEAR_POINTER_TAG(poll) != poll) {
                    Bun__internal_dispatch_ready_poll(loop, poll);
                    continue;
                }
#ifdef LIBUS_USE_EPOLL
                int events = loop->ready_polls[loop->current_ready_poll].events;
                const int error = events & EPOLLERR;
                const int eof = events & EPOLLHUP;
#else
                const struct kevent64_s* current_kevent = &loop->ready_polls[loop->current_ready_poll];
                const int16_t filter = current_kevent->filter;
                const uint16_t flags = current_kevent->flags;
                const uint32_t fflags = current_kevent->fflags;

                // > Multiple events which trigger the filter do not result in multiple kevents being placed on the kqueue
                // > Instead, the filter will aggregate the events into a single kevent struct
                // Note: EV_ERROR only sets the error in data as part of changelist. Not in this call!
                int events = 0
                    | ((filter & EVFILT_READ) ? LIBUS_SOCKET_READABLE : 0)
                    | ((filter & EVFILT_WRITE) ? LIBUS_SOCKET_WRITABLE : 0);
                const int error = (flags & (EV_ERROR)) ? ((int)fflags || 1) : 0;
                const int eof = (flags & (EV_EOF));
#endif
                /* Always filter all polls by what they actually poll for (callback polls always poll for readable) */
                events &= us_poll_events(poll);
                if (events || error || eof) {
                    us_internal_dispatch_ready_poll(poll, error, eof, events);
                }
            }
        }

        /* Emit post callback */
        us_internal_loop_post(loop);
    }
}

extern void Bun__JSC_onBeforeWait(void*);
extern void Bun__JSC_onAfterWait(void*);

void us_loop_run_bun_tick(struct us_loop_t *loop, const struct timespec* timeout) {
    if (loop->num_polls == 0)
        return;

    struct us_internal_callback_t *timer_callback = (struct us_internal_callback_t*)loop->data.sweep_timer;

    // Only integrate the loop if we haven't already.
    // Otherwise we will keep restarting the timer.
    if(!timer_callback->cb) {
        us_loop_integrate(loop);
    }

    /* Emit pre callback */
    us_internal_loop_pre(loop);

    /* Safe if jsc_vm is NULL */
    Bun__JSC_onBeforeWait(loop->data.jsc_vm);

    /* Fetch ready polls */
#ifdef LIBUS_USE_EPOLL
    loop->num_ready_polls = bun_epoll_pwait2(loop->fd, loop->ready_polls, 1024, timeout);
#else
    do {
        loop->num_ready_polls = kevent64(loop->fd, NULL, 0, loop->ready_polls, 1024, 0, timeout);
    } while (IS_EINTR(loop->num_ready_polls));
#endif

    Bun__JSC_onAfterWait(loop->data.jsc_vm);

    /* Iterate ready polls, dispatching them by type */
    for (loop->current_ready_poll = 0; loop->current_ready_poll < loop->num_ready_polls; loop->current_ready_poll++) {
        struct us_poll_t *poll = GET_READY_POLL(loop, loop->current_ready_poll);
        /* Any ready poll marked with nullptr will be ignored */
        if (LIKELY(poll)) {
            if (CLEAR_POINTER_TAG(poll) != poll) {
                Bun__internal_dispatch_ready_poll(loop, poll);
                continue;
            }
#ifdef LIBUS_USE_EPOLL
            int events = loop->ready_polls[loop->current_ready_poll].events;
            const int error = events & EPOLLERR;
            const int eof = events & EPOLLHUP;
#else
            const struct kevent64_s* current_kevent = &loop->ready_polls[loop->current_ready_poll];
            const int16_t filter = current_kevent->filter;
            const uint16_t flags = current_kevent->flags;
            const uint32_t fflags = current_kevent->fflags;

            // > Multiple events which trigger the filter do not result in multiple kevents being placed on the kqueue
            // > Instead, the filter will aggregate the events into a single kevent struct
            int events = 0
                | ((filter & EVFILT_READ) ? LIBUS_SOCKET_READABLE : 0)
                | ((filter & EVFILT_WRITE) ? LIBUS_SOCKET_WRITABLE : 0);

            // Note: EV_ERROR only sets the error in data as part of changelist. Not in this call!
            const int error = (flags & (EV_ERROR)) ? ((int)fflags || 1) : 0;
            const int eof = (flags & (EV_EOF));

#endif
            /* Always filter all polls by what they actually poll for (callback polls always poll for readable) */
            events &= us_poll_events(poll);
            if (events || error || eof) {
                us_internal_dispatch_ready_poll(poll, error, eof, events);
            }
        }
    }

    /* Emit post callback */
    us_internal_loop_post(loop);
}

void us_internal_loop_update_pending_ready_polls(struct us_loop_t *loop, struct us_poll_t *old_poll, struct us_poll_t *new_poll, int old_events, int new_events) {
#ifdef LIBUS_USE_EPOLL
    /* Epoll only has one ready poll per poll */
    int num_entries_possibly_remaining = 1;
#else
    /* Ready polls may contain same poll twice under kqueue, as one poll may hold two filters */
    int num_entries_possibly_remaining = 2;//((old_events & LIBUS_SOCKET_READABLE) ? 1 : 0) + ((old_events & LIBUS_SOCKET_WRITABLE) ? 1 : 0);
#endif

    /* Todo: for kqueue if we track things in us_change_poll it is possible to have a fast path with no seeking in cases of:
    * current poll being us AND we only poll for one thing */

    for (int i = loop->current_ready_poll; i < loop->num_ready_polls && num_entries_possibly_remaining; i++) {
        if (GET_READY_POLL(loop, i) == old_poll) {

            // if new events does not contain the ready events of this poll then remove (no we filter that out later on)
            SET_READY_POLL(loop, i, new_poll);

            num_entries_possibly_remaining--;
        }
    }
}

/* Poll */

#ifdef LIBUS_USE_KQUEUE
/* Helper function for setting or updating EVFILT_READ and EVFILT_WRITE */
int kqueue_change(int kqfd, int fd, int old_events, int new_events, void *user_data) {
    struct kevent64_s change_list[2];
    int change_length = 0;

    /* Do they differ in readable? */
    int is_readable =  (new_events & LIBUS_SOCKET_READABLE);
    int is_writable =  (new_events & LIBUS_SOCKET_WRITABLE);
    if ((new_events & LIBUS_SOCKET_READABLE) != (old_events & LIBUS_SOCKET_READABLE)) {
        EV_SET64(&change_list[change_length++], fd, EVFILT_READ, is_readable ? EV_ADD : EV_DELETE, 0, 0, (uint64_t)(void*)user_data, 0, 0);
    }
    
    if(!is_readable && !is_writable) {
        if(!(old_events & LIBUS_SOCKET_WRITABLE)) {
            // if we are not reading or writing, we need to add writable to receive FIN
            EV_SET64(&change_list[change_length++], fd, EVFILT_WRITE, EV_ADD, 0, 0, (uint64_t)(void*)user_data, 0, 0);
        }
    } else if ((new_events & LIBUS_SOCKET_WRITABLE) != (old_events & LIBUS_SOCKET_WRITABLE)) {
        /* Do they differ in writable? */    
        EV_SET64(&change_list[change_length++], fd, EVFILT_WRITE, (new_events & LIBUS_SOCKET_WRITABLE) ? EV_ADD : EV_DELETE, 0, 0, (uint64_t)(void*)user_data, 0, 0);
    } 
    int ret;
    do {
        ret = kevent64(kqfd, change_list, change_length, change_list, change_length, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    // ret should be 0 in most cases (not guaranteed when removing async)

    return ret;
}
#endif

struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int ext_size) {
    int events = us_poll_events(p);

    struct us_poll_t *new_p = us_realloc(p, sizeof(struct us_poll_t) + ext_size);
    if (p != new_p && events) {
#ifdef LIBUS_USE_EPOLL
        /* Hack: forcefully update poll by stripping away already set events */
        new_p->state.poll_type = us_internal_poll_type(new_p);
        us_poll_change(new_p, loop, events);
#else
        /* Forcefully update poll by resetting them with new_p as user data */
        kqueue_change(loop->fd, new_p->state.fd, 0, events, new_p);
#endif

        /* This is needed for epoll also (us_change_poll doesn't update the old poll) */
        us_internal_loop_update_pending_ready_polls(loop, p, new_p, events, events);
    }

    return new_p;
}

int us_poll_start_rc(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    p->state.poll_type = us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    if(!(events & LIBUS_SOCKET_READABLE) && !(events & LIBUS_SOCKET_WRITABLE)) {
        // if we are disabling readable, we need to add the other events to detect EOF/HUP/ERR
        events |= EPOLLRDHUP | EPOLLHUP | EPOLLERR;
    }
    event.events = events;
    event.data.ptr = p;
    int ret;
    do {
        ret = epoll_ctl(loop->fd, EPOLL_CTL_ADD, p->state.fd, &event);
    } while (IS_EINTR(ret));
    return ret;
#else
    return kqueue_change(loop->fd, p->state.fd, 0, events, p);
#endif
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    us_poll_start_rc(p, loop, events);
}

void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    int old_events = us_poll_events(p);
    if (old_events != events) {

        p->state.poll_type = us_internal_poll_type(p) | ((events & LIBUS_SOCKET_READABLE) ? POLL_TYPE_POLLING_IN : 0) | ((events & LIBUS_SOCKET_WRITABLE) ? POLL_TYPE_POLLING_OUT : 0);

#ifdef LIBUS_USE_EPOLL
        struct epoll_event event;
        if(!(events & LIBUS_SOCKET_READABLE) && !(events & LIBUS_SOCKET_WRITABLE)) {
             // if we are disabling readable, we need to add the other events to detect EOF/HUP/ERR
            events |= EPOLLRDHUP | EPOLLHUP | EPOLLERR;
        }
        event.events = events;
        event.data.ptr = p;
        int rc;
        do {
            rc = epoll_ctl(loop->fd, EPOLL_CTL_MOD, p->state.fd, &event);
        } while (IS_EINTR(rc));
#else
        kqueue_change(loop->fd, p->state.fd, old_events, events, p);
#endif
        /* Set all removed events to null-polls in pending ready poll list */
        //us_internal_loop_update_pending_ready_polls(loop, p, p, old_events, events);
    }
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    int old_events = us_poll_events(p);
    int new_events = 0;
#ifdef LIBUS_USE_EPOLL
    struct epoll_event event;
    int rc;
    do {
         rc = epoll_ctl(loop->fd, EPOLL_CTL_DEL, p->state.fd, &event);
    } while (IS_EINTR(rc));
#else
    if (old_events) {
        kqueue_change(loop->fd, p->state.fd, old_events, new_events, NULL);
    }
#endif

    /* Disable any instance of us in the pending ready poll list */
    us_internal_loop_update_pending_ready_polls(loop, p, 0, old_events, new_events);
}

size_t us_internal_accept_poll_event(struct us_poll_t *p) {
#ifdef LIBUS_USE_EPOLL
    int fd = us_poll_fd(p);
    uint64_t buf;
    ssize_t read_length = 0;
    do {
         read_length = read(fd, &buf, 8);
    } while (IS_EINTR(read_length));
    return buf;
#else
    /* Kqueue has no underlying FD for timers or user events */
    return 0;
#endif
}

/* Timer */
#ifdef LIBUS_USE_EPOLL
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_poll_t *p = us_create_poll(loop, fallthrough, sizeof(struct us_internal_callback_t) + ext_size);
    memset(p, 0, sizeof(struct us_internal_callback_t) + ext_size);
    int timerfd = timerfd_create(CLOCK_REALTIME, TFD_NONBLOCK | TFD_CLOEXEC);
    if (timerfd == -1) {
      return NULL;
    }
    us_poll_init(p, timerfd, POLL_TYPE_CALLBACK);

    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) p;
    cb->loop = loop;
    cb->cb_expects_the_loop = 0;
    cb->leave_poll_ready = 0;
    cb->has_added_timer_to_event_loop = 0;

    return (struct us_timer_t *) cb;
}
#else
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_calloc(1, sizeof(struct us_internal_callback_t) + ext_size);

    cb->loop = loop;
    cb->cb_expects_the_loop = 0;
    cb->leave_poll_ready = 0;

    /* Bug: us_internal_poll_set_type does not SET the type, it only CHANGES it */
    cb->p.state.poll_type = POLL_TYPE_POLLING_IN;
    us_internal_poll_set_type((struct us_poll_t *) cb, POLL_TYPE_CALLBACK);

    if (!fallthrough) {
        loop->num_polls++;
    }

    return (struct us_timer_t *) cb;
}
#endif

#ifdef LIBUS_USE_EPOLL
void us_timer_close(struct us_timer_t *timer, int fallthrough) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) timer;

    us_poll_stop(&cb->p, cb->loop);
    close(us_poll_fd(&cb->p));

     /* (regular) sockets are the only polls which are not freed immediately */
    if(fallthrough){
        us_free(timer);
    }else {
        us_poll_free((struct us_poll_t *) timer, cb->loop);
    }
}

void us_timer_set(struct us_timer_t *t, void (*cb)(struct us_timer_t *t), int ms, int repeat_ms) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) t;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    struct itimerspec timer_spec = {
        {repeat_ms / 1000, (long) (repeat_ms % 1000) * (long) 1000000},
        {ms / 1000, (long) (ms % 1000) * (long) 1000000}
    };

    timerfd_settime(us_poll_fd((struct us_poll_t *) t), 0, &timer_spec, NULL);

    // Avoid the system call overhead of re-adding this timer to the event loop only to receive EEXIST
    if (internal_cb->loop->data.sweep_timer == t) {
        if (internal_cb->has_added_timer_to_event_loop) {
            return;
        }
        internal_cb->has_added_timer_to_event_loop = 1;
    }
    us_poll_start((struct us_poll_t *) t, internal_cb->loop, LIBUS_SOCKET_READABLE);
}
#else
void us_timer_close(struct us_timer_t *timer, int fallthrough) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) timer;

    struct kevent64_s event;
    EV_SET64(&event, (uint64_t) (void*) internal_cb, EVFILT_TIMER, EV_DELETE, 0, 0, (uint64_t)internal_cb, 0, 0);
    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));


    /* (regular) sockets are the only polls which are not freed immediately */
    if(fallthrough){
        us_free(timer);
    }else {
        us_poll_free((struct us_poll_t *) timer, internal_cb->loop);
    }
}

void us_timer_set(struct us_timer_t *t, void (*cb)(struct us_timer_t *t), int ms, int repeat_ms) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) t;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    /* Bug: repeat_ms must be the same as ms, or 0 */
    struct kevent64_s event;
    uint64_t ptr = (uint64_t)(void*)internal_cb;
    EV_SET64(&event, ptr, EVFILT_TIMER, EV_ADD | (repeat_ms ? 0 : EV_ONESHOT), 0, ms, (uint64_t)internal_cb, 0, 0);

    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));
}
#endif

/* Async (internal helper for loop's wakeup feature) */
#ifdef LIBUS_USE_EPOLL
struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_poll_t *p = us_create_poll(loop, fallthrough, sizeof(struct us_internal_callback_t) + ext_size);
    memset(p, 0, sizeof(struct us_internal_callback_t) + ext_size);

    us_poll_init(p, eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC), POLL_TYPE_CALLBACK);

    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) p;
    cb->loop = loop;
    cb->cb_expects_the_loop = 1;
    cb->leave_poll_ready = 0;

    return (struct us_internal_async *) cb;
}

// identical code as for timer, make it shared for "callback types"
void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *cb = (struct us_internal_callback_t *) a;

    us_poll_stop(&cb->p, cb->loop);
    close(us_poll_fd(&cb->p));

    /* (regular) sockets are the only polls which are not freed immediately */
    us_poll_free((struct us_poll_t *) a, cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    us_poll_start((struct us_poll_t *) a, internal_cb->loop, LIBUS_SOCKET_READABLE);
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    uint64_t one = 1;
    int written = write(us_poll_fd((struct us_poll_t *) a), &one, 8);
    (void)written;
}
#else

#define MACHPORT_BUF_LEN 1024

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_internal_callback_t *cb = us_calloc(1, sizeof(struct us_internal_callback_t) + ext_size);
    cb->loop = loop;
    cb->cb_expects_the_loop = 1;
    cb->leave_poll_ready = 0;

    /* Bug: us_internal_poll_set_type does not SET the type, it only CHANGES it */
    cb->p.state.poll_type = POLL_TYPE_POLLING_IN;
    us_internal_poll_set_type((struct us_poll_t *) cb, POLL_TYPE_CALLBACK);

    if (!fallthrough) {
        loop->num_polls++;
    }

    cb->machport_buf = us_malloc(MACHPORT_BUF_LEN);
    mach_port_t self = mach_task_self();
    kern_return_t kr = mach_port_allocate(self, MACH_PORT_RIGHT_RECEIVE, &cb->port);

    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    // Insert a send right into the port since we also use this to send
    kr = mach_port_insert_right(self, cb->port, cb->port, MACH_MSG_TYPE_MAKE_SEND);
    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    // Modify the port queue size to be 1 because we are only
    // using it for notifications and not for any other purpose.
    mach_port_limits_t limits = { .mpl_qlimit = 1 };
    kr = mach_port_set_attributes(self, cb->port, MACH_PORT_LIMITS_INFO, (mach_port_info_t)&limits, MACH_PORT_LIMITS_INFO_COUNT);
    
    if (UNLIKELY(kr != KERN_SUCCESS)) {
        return NULL;
    }

    return (struct us_internal_async *) cb;
}

// identical code as for timer, make it shared for "callback types"
void us_internal_async_close(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    struct kevent64_s event;
    uint64_t ptr = (uint64_t)(void*)internal_cb;
    EV_SET64(&event, ptr, EVFILT_MACHPORT, EV_DELETE, 0, 0, (uint64_t)(void*)internal_cb, 0,0);
    
    int ret;
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    mach_port_deallocate(mach_task_self(), internal_cb->port);
    us_free(internal_cb->machport_buf);

    /* (regular) sockets are the only polls which are not freed immediately */
    us_poll_free((struct us_poll_t *) a, internal_cb->loop);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;

    internal_cb->cb = (void (*)(struct us_internal_callback_t *)) cb;

    // EVFILT_MACHPORT benchmarks faster than EVFILT_USER when using multiple threads
    // Very old versions of macOS required them to be portsets instead of ports
    // but that is no longer the case
    // There are not many examples on the internet of using machports this way
    // you can find one in Chromium's codebase.
    struct kevent64_s event;
    event.ident = internal_cb->port;
    event.filter = EVFILT_MACHPORT;
    event.flags = EV_ADD | EV_ENABLE;
    event.fflags = MACH_RCV_MSG | MACH_RCV_OVERWRITE;
    event.ext[0] = (uint64_t)(void*)internal_cb->machport_buf;
    event.ext[1] = MACHPORT_BUF_LEN;
    event.udata = (uint64_t)(void*)internal_cb;

    int ret; 
    do {
        ret = kevent64(internal_cb->loop->fd, &event, 1, &event, 1, KEVENT_FLAG_ERROR_EVENTS, NULL);
    } while (IS_EINTR(ret));

    if (UNLIKELY(ret == -1)) {
       abort();
    }
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) a;
    mach_msg_header_t msg = {
        .msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0),
        .msgh_size = sizeof(mach_msg_header_t),
        .msgh_remote_port = internal_cb->port,
        .msgh_local_port = MACH_PORT_NULL,
        .msgh_voucher_port = 0,
        .msgh_id = 0,
    };

    mach_msg_return_t kr = mach_msg(
        &msg,
        MACH_SEND_MSG | MACH_SEND_TIMEOUT,
        msg.msgh_size,
        0,
        MACH_PORT_NULL,
        0, // Fail instantly if the port is full
        MACH_PORT_NULL
    );
    
    switch (kr) {
        case KERN_SUCCESS: {
            break;
        }
        
        // This means that the send would've blocked because the
        // queue is full. We assume success because the port is full.
        case MACH_SEND_TIMED_OUT: {
            break;
        }

        // No space means it will wake up.
        case MACH_SEND_NO_BUFFER: {
            break;
        }

        default: {
            break;
        }
    }
}
#endif

int us_socket_get_error(int ssl, struct us_socket_t *s) {
    int error = 0;
    socklen_t len = sizeof(error);
    if (getsockopt(us_poll_fd((struct us_poll_t *) s), SOL_SOCKET, SO_ERROR, (char *) &error, &len) == -1) {
        return errno;
    }
    return error;
}

#endif
