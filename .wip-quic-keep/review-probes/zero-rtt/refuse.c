// Scratch LD_PRELOAD shim (review probe, not part of the repo).
// NQ_REFUSE=0rtt : sendmmsg() of a UDP datagram whose first QUIC packet is a v1 or v2 0-RTT long header
//                  (first byte 0b1101xxxx) fails with EAGAIN, as a full socket buffer would.
#define _GNU_SOURCE
#include <sys/socket.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int (*real_sendmmsg)(int, struct mmsghdr *, unsigned int, int);
static int mode = -1;
static unsigned long refused, passed_0rtt, total;

static void report(void) {
    fprintf(stderr, "ZRP-SHIM total=%lu refused_0rtt=%lu passed_0rtt=%lu\n", total, refused, passed_0rtt);
}

int sendmmsg(int fd, struct mmsghdr *mm, unsigned int vlen, int flags) {
    if (!real_sendmmsg) real_sendmmsg = dlsym(RTLD_NEXT, "sendmmsg");
    if (mode < 0) {
        const char *m = getenv("NQ_REFUSE");
        mode = m && !strcmp(m, "0rtt") ? 1 : 0;
        atexit(report);
    }
    total++;
    if (vlen >= 1 && mm[0].msg_hdr.msg_iovlen >= 1 && mm[0].msg_hdr.msg_iov[0].iov_len >= 5) {
        const unsigned char *b = mm[0].msg_hdr.msg_iov[0].iov_base;
        int v1 = b[1] == 0 && b[2] == 0 && b[3] == 0 && b[4] == 1; int v2 = b[1] == 0x6b && b[2] == 0x33 && b[3] == 0x43 && b[4] == 0xcf; int is0rtt = (v1 && (b[0] & 0xF0) == 0xD0) || (v2 && (b[0] & 0xF0) == 0xE0);
        if (is0rtt) {
            static long limit = -2; static int err = 0;
            if (limit == -2) { const char *l = getenv("NQ_REFUSE_N"); limit = l ? atol(l) : -1; const char *e = getenv("NQ_REFUSE_ERRNO"); err = e ? atoi(e) : EAGAIN; }
            if (mode == 1 && (limit < 0 || (long) refused < limit)) {
                if (refused++ < 3)
                    fprintf(stderr, "ZRP-SHIM refuse 0-RTT udp datagram len=%zu first=%02x\n",
                            mm[0].msg_hdr.msg_iov[0].iov_len, b[0]);
                errno = err;
                return -1;
            }
            if (passed_0rtt++ < 3)
                fprintf(stderr, "ZRP-SHIM pass 0-RTT udp datagram len=%zu first=%02x\n",
                        mm[0].msg_hdr.msg_iov[0].iov_len, b[0]);
        }
    }
    return real_sendmmsg(fd, mm, vlen, flags);
}
