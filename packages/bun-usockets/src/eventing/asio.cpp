/*
 * Authored by Alex Hultman, 2018-2021.
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

extern "C" {
    #include "libusockets.h"
    #include "internal/internal.h"
    #include <stdlib.h>
}

#ifdef LIBUS_USE_ASIO

#include <boost/asio.hpp>
#include <iostream>
#include <mutex>
#include <memory>
#include <boost/version.hpp>

// New interfaces require boost 1.66.0
#if BOOST_VERSION < 106600
#define LIBUS_USE_OLD_ASIO
#define LIBUS_ASIO_DESCRIPTOR boost::asio::posix::stream_descriptor
#define LIBUS_ASIO_LOOP boost::asio::io_service
#else
#define LIBUS_ASIO_DESCRIPTOR boost::asio::posix::descriptor
#define LIBUS_ASIO_LOOP boost::asio::io_context
#endif

// setting polls to 1 disables fallthrough
int polls = 0; // temporary solution keeping track of outstanding work

// define a timer internally as something that inherits from callback_t
// us_timer_t is convertible to this one
struct boost_timer : us_internal_callback_t {
    boost::asio::deadline_timer timer;
    std::shared_ptr<boost_timer> isValid;

    unsigned char nr = 0;

    boost_timer(LIBUS_ASIO_LOOP *io) : timer(*io) {
        isValid.reset(this, [](boost_timer *t) {});
    }
};

struct boost_block_poll_t : LIBUS_ASIO_DESCRIPTOR {

    boost_block_poll_t(LIBUS_ASIO_LOOP *io, us_poll_t *p) : LIBUS_ASIO_DESCRIPTOR(*io), p(p) {
        isValid.reset(this, [](boost_block_poll_t *t) {});
    }

    std::shared_ptr<boost_block_poll_t> isValid;

    unsigned char nr = 0;
    struct us_poll_t *p;
};

extern "C" {

// poll
void us_poll_init(struct us_poll_t *p, LIBUS_SOCKET_DESCRIPTOR fd, int poll_type) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;
    boost_block->assign(fd);
    p->poll_type = poll_type;
    p->events = 0;

    p->fd = fd; //apparently we access fd after close
}

void us_poll_free(struct us_poll_t *p, struct us_loop_t *loop) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;

    delete boost_block;
    free(p);
}

void poll_for_error(struct boost_block_poll_t *boost_block) {
    /* There is no such thing as polling for error in old asio */
#ifndef LIBUS_USE_OLD_ASIO
    polls++;
    boost_block->async_wait(boost::asio::posix::descriptor::wait_type::wait_error, [nr = boost_block->nr, weakBoostBlock = std::weak_ptr<boost_block_poll_t>(boost_block->isValid)](boost::system::error_code ec) {
        polls--;
        
        if (ec != boost::asio::error::operation_aborted) {

            // post mortem check
            struct boost_block_poll_t *boost_block;
            if (auto observe = weakBoostBlock.lock()) {
                boost_block = observe.get();
            } else {
                return;
            }

            // get boost_block from weakptr
            if (nr != boost_block->nr) {
                return;
            }

            poll_for_error(boost_block); // ska man verkligen polla for error igen
            us_internal_dispatch_ready_poll(boost_block->p, 1, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
        }
    });
#endif
}

void poll_for_read(struct boost_block_poll_t *boost_block);

inline void handle_read(const std::weak_ptr<boost_block_poll_t> &weakBoostBlock, unsigned char nr, boost::system::error_code ec) {
    if (ec != boost::asio::error::operation_aborted) {

        // post mortem check
        struct boost_block_poll_t *boost_block;
        if (auto observe = weakBoostBlock.lock()) {
            boost_block = observe.get();
        } else {
            return;
        }

        // get boost_block from weakptr
        if (nr != boost_block->nr) {
            return;
        }

        poll_for_read(boost_block);
        us_internal_dispatch_ready_poll(boost_block->p, ec ? -1 : 0, LIBUS_SOCKET_READABLE);
    }
}

void poll_for_read(struct boost_block_poll_t *boost_block) {
    polls++;
#ifndef LIBUS_USE_OLD_ASIO
    boost_block->async_wait(boost::asio::posix::descriptor::wait_type::wait_read, [nr = boost_block->nr, weakBoostBlock = std::weak_ptr<boost_block_poll_t>(boost_block->isValid)](boost::system::error_code ec) {
        polls--;
        handle_read(weakBoostBlock, nr, ec);
    });
#else
    boost_block->async_read_some(boost::asio::null_buffers(), [nr = boost_block->nr, weakBoostBlock = std::weak_ptr<boost_block_poll_t>(boost_block->isValid)](boost::system::error_code ec, std::size_t) {
        polls--;
        handle_read(weakBoostBlock, nr, ec);
    });
#endif
}

void poll_for_write(struct boost_block_poll_t *boost_block);

inline void handle_write(const std::weak_ptr<boost_block_poll_t> &weakBoostBlock, unsigned char nr, boost::system::error_code ec) {
    if (ec != boost::asio::error::operation_aborted) {

        // post mortem check
        struct boost_block_poll_t *boost_block;
        if (auto observe = weakBoostBlock.lock()) {
            boost_block = observe.get();
        } else {
            return;
        }

        // get boost_block from weakptr
        if (nr != boost_block->nr) {
            return;
        }
        poll_for_write(boost_block);
        us_internal_dispatch_ready_poll(boost_block->p, ec ? -1 : 0, LIBUS_SOCKET_WRITABLE);
    }
}

void poll_for_write(struct boost_block_poll_t *boost_block) {
    polls++;
#ifndef LIBUS_USE_OLD_ASIO
    boost_block->async_wait(boost::asio::posix::descriptor::wait_type::wait_write, [nr = boost_block->nr, weakBoostBlock = std::weak_ptr<boost_block_poll_t>(boost_block->isValid)](boost::system::error_code ec) {
        polls--;
        handle_write(weakBoostBlock, nr, ec);
    });
#else
    boost_block->async_write_some(boost::asio::null_buffers(), [nr = boost_block->nr, weakBoostBlock = std::weak_ptr<boost_block_poll_t>(boost_block->isValid)](boost::system::error_code ec, std::size_t) {
        polls--;
        handle_write(weakBoostBlock, nr, ec);
    });
#endif
}

void us_poll_start(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;

    p->events = events;
    poll_for_error(boost_block);

    if (events & LIBUS_SOCKET_READABLE) {
        poll_for_read(boost_block);
    }

    if (events & LIBUS_SOCKET_WRITABLE) {
        poll_for_write(boost_block);
    }
}

void us_poll_change(struct us_poll_t *p, struct us_loop_t *loop, int events) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;

    boost_block->nr++;
    boost_block->cancel();

    us_poll_start(p, loop, events);
}

void us_poll_stop(struct us_poll_t *p, struct us_loop_t *loop) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;

    boost_block->nr++;
    boost_block->release();
}

int us_poll_events(struct us_poll_t *p) {
    return p->events;
}

unsigned int us_internal_accept_poll_event(struct us_poll_t *p) {
    return 0;
}

int us_internal_poll_type(struct us_poll_t *p) {
    return p->poll_type;
}

void us_internal_poll_set_type(struct us_poll_t *p, int poll_type) {
    p->poll_type = poll_type;
}

LIBUS_SOCKET_DESCRIPTOR us_poll_fd(struct us_poll_t *p) {
    struct boost_block_poll_t *boost_block = (struct boost_block_poll_t *) p->boost_block;


    return p->fd;

    //return boost_block->native_handle();
}

// if we get an io_context ptr as hint, we use it
// otherwise we create a new one for only us
struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(struct us_loop_t *loop), void (*pre_cb)(struct us_loop_t *loop), void (*post_cb)(struct us_loop_t *loop), unsigned int ext_size) {
    struct us_loop_t *loop = (struct us_loop_t *) malloc(sizeof(struct us_loop_t) + ext_size);

    loop->io = hint ? hint : new LIBUS_ASIO_LOOP();
    loop->is_default = hint != 0;

    // here we create two unreffed handles - timer and async
    us_internal_loop_data_init(loop, wakeup_cb, pre_cb, post_cb);

    // if we do not own this loop, we need to integrate and set up timer
    if (hint) {
        us_loop_integrate(loop);
    }

    return loop;
}

// based on if this was default loop or not
void us_loop_free(struct us_loop_t *loop) {
    us_internal_loop_data_free(loop);

    if (!loop->is_default) {
        delete (LIBUS_ASIO_LOOP *) loop->io;
    }

    free(loop);
}

// we need fallthrough to correspond to our polls
// therefore we exit when our polls are 0
// if third party asio server wants to keep the loop running
// they have to use a guard such as a us_timer_t
void us_loop_run(struct us_loop_t *loop) {
    us_loop_integrate(loop);

    // this way of running adds one extra epoll_wait per event loop iteration
    // but does not add per-poll overhead. besides, asio is sprinkled with inefficiencies
    // everywhere so it's negligible for what it solves (we must have pre, post callbacks)
    while (polls) {
        us_internal_loop_pre(loop);
        size_t num = ((LIBUS_ASIO_LOOP *) loop->io)->run_one();
        if (!num) {
            break;
        }
        
        for (int i = 0; true; i++) {
            num = ((LIBUS_ASIO_LOOP *) loop->io)->poll_one();
            if (!num || i == 999) {
                break;
            }
        }
        us_internal_loop_post(loop);
    }
}

struct us_poll_t *us_create_poll(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct us_poll_t *p = (struct us_poll_t *) malloc(sizeof(struct us_poll_t) + ext_size);
    p->boost_block = new boost_block_poll_t( (LIBUS_ASIO_LOOP *)loop->io, p);

    return p;
}

/* If we update our block position we have to updarte the uv_poll data to point to us */
struct us_poll_t *us_poll_resize(struct us_poll_t *p, struct us_loop_t *loop, unsigned int ext_size) {
    p = (struct us_poll_t *) realloc(p, sizeof(struct us_poll_t) + ext_size);

    // captures must never capture p directly, only boost_block and derive p from there
    ((struct boost_block_poll_t *) p->boost_block)->p = p;

    return p;
}

// timer
struct us_timer_t *us_create_timer(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct boost_timer *cb = (struct boost_timer *) malloc(sizeof(struct boost_timer) + ext_size);

    // inplace construct the timer on this callback_t
    new (cb) boost_timer((LIBUS_ASIO_LOOP *)loop->io);

    cb->loop = loop;
    cb->cb_expects_the_loop = 0;
    cb->p.poll_type = POLL_TYPE_CALLBACK; // this is missing from libuv flow

    if (fallthrough) {
        //uv_unref((uv_handle_t *) uv_timer);
    }

    return (struct us_timer_t *) cb;
}

void *us_timer_ext(struct us_timer_t *timer) {
    return ((struct boost_timer *) timer) + 1;
}

void us_timer_close(struct us_timer_t *t) {
    ((boost_timer *) t)->timer.cancel();
    ((boost_timer *) t)->~boost_timer();
    free(t);
}

void poll_for_timeout(struct boost_timer *b_timer, int repeat_ms) {
    b_timer->timer.async_wait([nr = b_timer->nr, repeat_ms, weakBoostBlock = std::weak_ptr<boost_timer>(b_timer->isValid)](const boost::system::error_code &ec) {
        if (ec != boost::asio::error::operation_aborted) {

            struct boost_timer *b_timer;
            if (auto observe = weakBoostBlock.lock()) {
                b_timer = observe.get();
            } else {
                return;
            }

            if (nr != b_timer->nr) {
                return;
            }

            if (repeat_ms) {

                if (!polls) {
                    // we do fallthrough if no other polling
                    // this is problematic if WE fallthrough
                    // but other parts do not
                    // that causes timeouts to stop working
                    // we should really ask the executor if there is work
                    // if there is, then continue ticking until there isn't
                    return;
                }

                b_timer->timer.expires_at(b_timer->timer.expires_at() + boost::posix_time::milliseconds(repeat_ms));
                poll_for_timeout(b_timer, repeat_ms);
            }
            us_internal_dispatch_ready_poll((struct us_poll_t *)b_timer, 0, LIBUS_SOCKET_READABLE);
        }
    });
}

void us_timer_set(struct us_timer_t *t, void (*cb)(struct us_timer_t *t), int ms, int repeat_ms) {
    struct boost_timer *b_timer = (struct boost_timer *) t;

    if (!ms) {
        b_timer->nr++;
        b_timer->timer.cancel();
    } else {
        b_timer->cb = (void(*)(struct us_internal_callback_t *)) cb;

        b_timer->timer.expires_from_now(boost::posix_time::milliseconds(ms));
        poll_for_timeout(b_timer, repeat_ms);
    }
}

struct us_loop_t *us_timer_loop(struct us_timer_t *t) {
    struct us_internal_callback_t *internal_cb = (struct us_internal_callback_t *) t;

    return internal_cb->loop;
}

// async (internal only) probably map to io_context::post
struct boost_async : us_internal_callback_t {
    std::mutex m;
    std::shared_ptr<boost_async> isValid;

    boost_async() {
        isValid.reset(this, [](boost_async *a) {});
    }
};

struct us_internal_async *us_internal_create_async(struct us_loop_t *loop, int fallthrough, unsigned int ext_size) {
    struct boost_async *cb = (struct boost_async *) malloc(sizeof(struct boost_async) + ext_size);

    // inplace construct
    new (cb) boost_async();

    // these properties are accessed from another thread when wakeup
    cb->m.lock();
    cb->loop = loop; // the only lock needed
    cb->cb_expects_the_loop = 0;
    cb->p.poll_type = POLL_TYPE_CALLBACK; // this is missing from libuv flow
    cb->m.unlock();

    if (fallthrough) {
        //uv_unref((uv_handle_t *) uv_timer);
    }

    return (struct us_internal_async *) cb;
}

void us_internal_async_close(struct us_internal_async *a) {
    ((boost_async *) a)->~boost_async();
    free(a);
}

void us_internal_async_set(struct us_internal_async *a, void (*cb)(struct us_internal_async *)) {
    struct boost_async *internal_cb = (struct boost_async *) a;

    internal_cb->cb = (void(*)(struct us_internal_callback_t *)) cb;
}

void us_internal_async_wakeup(struct us_internal_async *a) {
    struct boost_async *cb = (struct boost_async *) a;

    // this doesn't really guarantee loop.io being visible here
    // really we should use the loops mutex, and have the loops constructor
    // use its own mutex, then we are guaranteed to have visibility here
    cb->m.lock();
    LIBUS_ASIO_LOOP *io = (LIBUS_ASIO_LOOP *)cb->loop->io;
    cb->m.unlock();

    // should increase and decrease polls (again, loop mutex)
    io->post([weakBoostBlock = std::weak_ptr<boost_async>(cb->isValid)]() {

        // was the async deleted before we came here?
        struct boost_async *cb;
        if (auto observe = weakBoostBlock.lock()) {
            cb = observe.get();
        } else {
            return;
        }

        us_internal_dispatch_ready_poll((struct us_poll_t *) cb, 0, 0);

    });
}

}

#endif
