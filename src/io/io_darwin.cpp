
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
  mach_msg_empty_send_t message;
  memset(&message, 0, sizeof(message));
  message.header.msgh_size = sizeof(message);
  // We use COPY_SEND which will not increment any send ref
  // counts because it'll reuse the existing send right.
  message.header.msgh_bits = MACH_MSGH_BITS_REMOTE(MACH_MSG_TYPE_COPY_SEND);
  message.header.msgh_remote_port = waker;
  message.header.msgh_local_port = MACH_PORT_NULL;
  mach_msg_return_t kr = mach_msg_send(&message.header);
  
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
          mach_msg_destroy(&message.header);
          return false;
      }
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