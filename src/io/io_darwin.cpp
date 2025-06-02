
#ifdef __APPLE__

#include <sys/event.h>

#include <mach/mach.h>
// errno
#include <errno.h>

#include "wtf/Assertions.h"

extern "C" mach_port_t io_darwin_create_machport(uint64_t wakeup, int32_t fd,
    void* wakeup_buffer_,
    size_t nbytes)
{

    mach_port_t port;
    mach_port_t self = mach_task_self();
    kern_return_t kr = mach_port_allocate(self, MACH_PORT_RIGHT_RECEIVE, &port);

    if (kr != KERN_SUCCESS) [[unlikely]] {
        return 0;
    }

    // Insert a send right into the port since we also use this to send
    kr = mach_port_insert_right(self, port, port, MACH_MSG_TYPE_MAKE_SEND);
    if (kr != KERN_SUCCESS) [[unlikely]] {
        return 0;
    }

    // Modify the port queue size to be 1 because we are only
    // using it for notifications and not for any other purpose.
    mach_port_limits_t limits = { .mpl_qlimit = 1 };
    kr = mach_port_set_attributes(self, port, MACH_PORT_LIMITS_INFO,
        (mach_port_info_t)&limits,
        MACH_PORT_LIMITS_INFO_COUNT);

    if (kr != KERN_SUCCESS) [[unlikely]] {
        return 0;
    }

    // Configure the event to directly receive the Mach message as part of the
    // kevent64() call.
    kevent64_s event {};
    event.ident = port;
    event.filter = EVFILT_MACHPORT;
    event.flags = EV_ADD | EV_ENABLE;
    event.fflags = MACH_RCV_MSG | MACH_RCV_OVERWRITE;
    event.ext[0] = reinterpret_cast<uint64_t>(wakeup_buffer_);
    event.ext[1] = nbytes;

    while (true) {
        int rv = kevent64(fd, &event, 1, NULL, 0, 0, NULL);
        if (rv == -1) {
            if (errno == EINTR) {
                continue;
            }

            return 0;
        }

        return port;
    }
}

extern "C" bool getaddrinfo_send_reply(mach_port_t port,
    void (*sendReply)(void*))
{
    mach_msg_empty_rcv_t msg;
    mach_msg_return_t status;

    status = mach_msg(&msg.header, MACH_RCV_MSG, 0, sizeof(msg), port,
        MACH_MSG_TIMEOUT_NONE, MACH_PORT_NULL);
    if (status != MACH_MSG_SUCCESS) {
        return false;
    }
    sendReply(&msg);
    return true;
}

extern "C" bool io_darwin_schedule_wakeup(mach_port_t waker)
{
    mach_msg_header_t msg = {
        .msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0),
        .msgh_size = sizeof(mach_msg_header_t),
        .msgh_remote_port = waker,
        .msgh_local_port = MACH_PORT_NULL,
        .msgh_voucher_port = 0,
        .msgh_id = 0,
    };

    mach_msg_return_t kr = mach_msg(&msg, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
        msg.msgh_size, 0, MACH_PORT_NULL,
        0, // Fail instantly if the port is full
        MACH_PORT_NULL);

    switch (kr) {
    case MACH_MSG_SUCCESS: {
        return true;
    }

    // This means that the send would've blocked because the
    // queue is full. We assume success because the port is full.
    case MACH_SEND_TIMED_OUT: {
        return true;
    }

    // No space means it will wake up.
    case MACH_SEND_NO_BUFFER: {
        return true;
    }

    default: {
        ASSERT_NOT_REACHED_WITH_MESSAGE("mach_msg failed with %x", kr);
        return false;
    }
    }
}

extern "C" void darwin_select_thread_fd_is_readable(int fd);

extern "C" void darwin_select_thread_wait_for_events(int kqueue_fd, mach_port_t* _Nonnull machport, char* machport_buffer, size_t machport_buffer_size, int* fds, size_t fds_len)
{
    fd_set read_set;
    FD_ZERO(&read_set);
    int max_fd = kqueue_fd;
    for (size_t i = 0; i < fds_len; i++) {
        FD_SET(fds[i], &read_set);
        if (fds[i] > max_fd) {
            max_fd = fds[i];
        }
    }
    FD_SET(kqueue_fd, &read_set);

    while (true) {
        int rv = select(max_fd + 1, &read_set, NULL, NULL, NULL);
        if (rv == -1) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }

        for (size_t i = 0; i < fds_len; i++) {
            int fd = fds[i];
            if (FD_ISSET(fd, &read_set)) {
                darwin_select_thread_fd_is_readable(fd);
            }
        }

        if (FD_ISSET(kqueue_fd, &read_set)) {
            struct kevent64_s event[5];
            while (true) {
                // a 0 timeout so it immediately returns
                // Use the flag to effect a poll
                int ret = kevent64(kqueue_fd, NULL, 0, event, 5, 0, NULL);

                if (ret == -1) {
                    if (errno == EINTR) {
                        continue;
                    }
                    break;
                }

                if (ret == 0) {
                    break;
                }

                for (size_t i = 0; i < ret; i++) {
                    if (event[i].filter == EVFILT_MACHPORT) {
                        // Read the machport message to clear it and prevent continuous wakeups
                        mach_msg_header_t msg;
                        mach_msg_return_t msg_ret = mach_msg(&msg, MACH_RCV_MSG | MACH_RCV_TIMEOUT, 0, sizeof(msg), *machport, 0, MACH_PORT_NULL);

                        // Validate the message was received successfully
                        if (msg_ret != MACH_MSG_SUCCESS && msg_ret != MACH_RCV_TIMED_OUT) {
                            break;
                        }
                    }
                }

                // Halt here, we've received a message from the machport, so we need to restart the outer loop.
                return;
            }
        }

        // infinite loop
    }
}

extern "C" bool darwin_select_thread_is_needed_for_fd(int fd)
{
    // Test if the given fd is compatible with kqueue
    // Some fd configurations on macOS don't work well with kqueue
    int test_kqueue = kqueue();
    if (test_kqueue == -1) {
        return true; // If kqueue fails, definitely need select fallback
    }

    struct kevent64_s event = {};
    event.ident = fd;
    event.filter = EVFILT_READ;
    event.flags = EV_ADD | EV_ENABLE;

    // Try to register fd with kqueue
    int result = kevent64(test_kqueue, &event, 1, NULL, 0, 0, NULL);
    bool needs_fallback = (result == -1);
    close(test_kqueue);

    // If kevent fails for stdin, we need the select fallback
    return needs_fallback;
}

#else

// stub out these symbols
extern "C" int io_darwin_create_machport(unsigned long long wakeup, int fd,
    void* wakeup_buffer_,
    unsigned long long nbytes)
{
    return 0;
}

// stub out these symbols
extern "C" bool io_darwin_schedule_wakeup(void* waker) { return false; }

#endif
