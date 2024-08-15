
#ifdef __APPLE__

#include <sys/event.h>

#include <mach/mach.h>
// errno
#include <errno.h>

#include "wtf/Assertions.h"

extern "C" mach_port_t io_darwin_create_machport(uint64_t wakeup, int32_t fd,
                                                 void *wakeup_buffer_,
                                                 size_t nbytes) {

  mach_port_t port;
  mach_port_t self = mach_task_self();
  kern_return_t kr = mach_port_allocate(self, MACH_PORT_RIGHT_RECEIVE, &port);

  if (UNLIKELY(kr != KERN_SUCCESS)) {
      return 0;
  }

  // Insert a send right into the port since we also use this to send
  kr = mach_port_insert_right(self, port, port, MACH_MSG_TYPE_MAKE_SEND);
  if (UNLIKELY(kr != KERN_SUCCESS)) {
      return 0;
  }

  // Modify the port queue size to be 1 because we are only
  // using it for notifications and not for any other purpose.
  mach_port_limits_t limits = { .mpl_qlimit = 1 };
  kr = mach_port_set_attributes(self, port, MACH_PORT_LIMITS_INFO, (mach_port_info_t)&limits, MACH_PORT_LIMITS_INFO_COUNT);
  
  if (UNLIKELY(kr != KERN_SUCCESS)) {
      return 0;
  }


  // Configure the event to directly receive the Mach message as part of the
  // kevent64() call.
  kevent64_s event{};
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
                                       void (*sendReply)(void *)) {
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

extern "C" bool io_darwin_schedule_wakeup(mach_port_t waker) {
  mach_msg_header_t msg = {
      .msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0),
      .msgh_size = sizeof(mach_msg_header_t),
      .msgh_remote_port = waker,
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

#else

// stub out these symbols
extern "C" int io_darwin_create_machport(unsigned long long wakeup, int fd,
                                         void *wakeup_buffer_,
                                         unsigned long long nbytes) {
  return 0;
}

// stub out these symbols
extern "C" bool io_darwin_schedule_wakeup(void *waker) { return false; }

#endif