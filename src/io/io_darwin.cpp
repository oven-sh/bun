
#ifdef __APPLE__

#include <sys/event.h>

#include <mach/mach.h>
// errno
#include <errno.h>

extern "C" mach_port_t io_darwin_create_machport(uint64_t wakeup, int32_t fd,
                                                 void *wakeup_buffer_,
                                                 size_t nbytes) {

  mach_port_t port;
  // Create a Mach port that will be used to wake up the pump
  kern_return_t kr =
      mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &port);
  if (kr != KERN_SUCCESS) {
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

extern "C" bool io_darwin_schedule_wakeup(mach_port_t waker) {
  mach_msg_empty_send_t message{};
  message.header.msgh_size = sizeof(message);
  message.header.msgh_bits =
      MACH_MSGH_BITS_REMOTE(MACH_MSG_TYPE_MAKE_SEND_ONCE);
  message.header.msgh_remote_port = waker;
  kern_return_t kr = mach_msg_send(&message.header);
  if (kr != KERN_SUCCESS) {
    // If io_darwin_schedule_wakeup() is being called by other threads faster
    // than the pump can dispatch work, the kernel message queue for the wakeup
    // port can fill The kernel does return a SEND_ONCE right in the case of
    // failure, which must be destroyed to avoid leaking.
    mach_msg_destroy(&message.header);
    return false;
  }

  return true;
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