
#ifdef __APPLE__

#include <sys/event.h>

#include <mach/mach.h>
// errno
#include <errno.h>

#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <sys/types.h>

extern "C" int close$NOCANCEL(int fd);

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

#ifndef fd_t
#define fd_t int
#endif
static fd_t apple_no_sigpipe(fd_t fd) {
  int no_sigpipe = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &no_sigpipe, sizeof(int));

  return fd;
}

static fd_t bsd_set_nonblocking(fd_t fd) {
#ifdef _WIN32
  /* Libuv will set windows sockets as non-blocking */
#else
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
#endif
  return fd;
}

static void bsd_socket_nodelay(fd_t fd, int enabled) {
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, (void *)&enabled, sizeof(enabled));
}

static fd_t bsd_create_socket(int domain, int type, int protocol) {
  // returns INVALID_SOCKET on error
  int flags = 0;
#if defined(SOCK_CLOEXEC) && defined(SOCK_NONBLOCK)
  flags = SOCK_CLOEXEC | SOCK_NONBLOCK;
#endif

  fd_t created_fd = socket(domain, type | flags, protocol);

  return bsd_set_nonblocking(apple_no_sigpipe(created_fd));
}

extern "C" int io_darwin_create_listen_socket(const char *host,
                                              const char *port, bool reuse) {
  struct addrinfo hints, *result;
  memset(&hints, 0, sizeof(struct addrinfo));

  hints.ai_flags = AI_PASSIVE;
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;

  if (getaddrinfo(host, port, &hints, &result)) {
    return -1;
  }

  fd_t listenFd = -1;
  struct addrinfo *listenAddr;
  for (struct addrinfo *a = result; a && listenFd == -1; a = a->ai_next) {
    if (a->ai_family == AF_INET6) {
      listenFd =
          bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
      listenAddr = a;
    }
  }

  for (struct addrinfo *a = result; a && listenFd == -1; a = a->ai_next) {
    if (a->ai_family == AF_INET) {
      listenFd =
          bsd_create_socket(a->ai_family, a->ai_socktype, a->ai_protocol);
      listenAddr = a;
    }
  }

  if (listenFd == -1) {
    freeaddrinfo(result);
    return -1;
  }

  if (reuse) {
    /* Otherwise, always enable SO_REUSEPORT and SO_REUSEADDR _unless_ options
     * specify otherwise */
#if /*defined(__linux) &&*/ defined(SO_REUSEPORT)
    int optval = 1;
    setsockopt(listenFd, SOL_SOCKET, SO_REUSEPORT, &optval, sizeof(optval));
#endif
    int enabled = 1;
    setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, (int *)&enabled,
               sizeof(enabled));
  }

#ifdef IPV6_V6ONLY
  int disabled = 0;
  setsockopt(listenFd, IPPROTO_IPV6, IPV6_V6ONLY, (int *)&disabled,
             sizeof(disabled));
#endif

  if (bind(listenFd, listenAddr->ai_addr, (socklen_t)listenAddr->ai_addrlen) ||
      listen(listenFd, 512)) {
    close$NOCANCEL(listenFd);
    freeaddrinfo(result);
    return -1;
  }

  freeaddrinfo(result);
  return listenFd;
}

#endif