// LD_PRELOAD shim for a review probe. While the file named by ACKDG_FLAG
// exists and holds a UDP port number, every sendmmsg() whose first message is
// addressed to that port fails with EAGAIN (a socket that would block). All
// other sends pass. The probe writes the port of the relay's client-facing
// socket there, so only the QUIC client is refused.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

static const char *flag_path;
static long refused_run;
static long refused_total;

__attribute__((constructor)) static void ackdg_init(void) { flag_path = getenv("ACKDG_FLAG"); }

static int refused_port(void) {
  if (!flag_path) return -1;
  int fd = (int)syscall(SYS_open, flag_path, O_RDONLY);
  if (fd < 0) return -1;
  char buf[16] = {0};
  long n = syscall(SYS_read, fd, buf, sizeof(buf) - 1);
  syscall(SYS_close, fd);
  if (n <= 0) return -1;
  return atoi(buf);
}

int sendmmsg(int fd, struct mmsghdr *vec, unsigned int vlen, int flags) {
  int port = refused_port();
  if (port > 0 && vlen > 0 && vec[0].msg_hdr.msg_name) {
    const struct sockaddr *sa = vec[0].msg_hdr.msg_name;
    int dport = -1;
    if (sa->sa_family == AF_INET) dport = ntohs(((const struct sockaddr_in *)sa)->sin_port);
    else if (sa->sa_family == AF_INET6) dport = ntohs(((const struct sockaddr_in6 *)sa)->sin6_port);
    if (dport == port) {
      refused_run++;
      refused_total++;
      errno = EAGAIN;
      return -1;
    }
  }
  if (refused_run) {
    dprintf(2, "@@SHIM %ld sendmmsg calls refused with EAGAIN (total %ld)\n", refused_run, refused_total);
    refused_run = 0;
  }
  return (int)syscall(SYS_sendmmsg, fd, vec, vlen, flags);
}
