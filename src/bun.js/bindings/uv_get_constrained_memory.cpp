// This code is copied from libuv. Thanks to libuv developers.
/* Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

#include "root.h"
#include <cstdint>
#include <unistd.h>

#if OS(LINUX) || OS(FREEBSD)

#include <fcntl.h>

static int uv__open_cloexec(const char* path, int flags)
{
    int fd;

    fd = open(path, flags | O_CLOEXEC, 0);
    if (fd == -1)
        return errno;

    return fd;
}

static int uv__close_nocheckstdio(int fd)
{
    int saved_errno;
    int rc;

    saved_errno = errno;
    rc = close(fd);
    if (rc == -1) {
        if (errno == EINTR || errno == EINPROGRESS)
            rc = 0; /* The close is in progress, not an error. */
        errno = saved_errno;
    }

    return rc;
}

static int uv__slurp(const char* filename, char* buf, size_t len)
{
    ssize_t n;
    int fd;

    assert(len > 0);

    fd = uv__open_cloexec(filename, O_RDONLY);
    if (fd < 0)
        return fd;

    do
        n = read(fd, buf, len - 1);
    while (n == -1 && errno == EINTR);

    if (uv__close_nocheckstdio(fd))
        abort();

    if (n < 0)
        return errno;

    buf[n] = '\0';

    return 0;
}

static uint64_t uv__read_uint64(const char* filename)
{
    char buf[32]; /* Large enough to hold an encoded uint64_t. */
    uint64_t rc;

    rc = 0;
    if (0 == uv__slurp(filename, buf, sizeof(buf)))
        if (1 != sscanf(buf, "%" PRIu64, &rc))
            if (0 == strcmp(buf, "max\n"))
                rc = UINT64_MAX;

    return rc;
}

/* Given a buffer with the contents of a cgroup1 /proc/self/cgroups,
 * finds the location and length of the memory controller mount path.
 * This disregards the leading / for easy concatenation of paths.
 * Returns NULL if the memory controller wasn't found. */
static char* uv__cgroup1_find_memory_controller(char buf[1024],
    int* n)
{
    char* p;

    /* Seek to the memory controller line. */
    p = strchr(buf, ':');
    while (p != NULL && strncmp(p, ":memory:", 8)) {
        p = strchr(p, '\n');
        if (p != NULL)
            p = strchr(p, ':');
    }

    if (p != NULL) {
        /* Determine the length of the mount path. */
        p = p + strlen(":memory:/");
        *n = (int)strcspn(p, "\n");
    }

    return p;
}

static void uv__get_cgroup1_memory_limits(char buf[1024], uint64_t* high,
    uint64_t* max)
{
    char filename[4097];
    char* p;
    int n;
    uint64_t cgroup1_max;

    /* Find out where the controller is mounted. */
    p = uv__cgroup1_find_memory_controller(buf, &n);
    if (p != NULL) {
        snprintf(filename, sizeof(filename),
            "/sys/fs/cgroup/memory/%.*s/memory.soft_limit_in_bytes", n, p);
        *high = uv__read_uint64(filename);

        snprintf(filename, sizeof(filename),
            "/sys/fs/cgroup/memory/%.*s/memory.limit_in_bytes", n, p);
        *max = uv__read_uint64(filename);

        /* If the controller wasn't mounted, the reads above will have failed,
         * as indicated by uv__read_uint64 returning 0.
         */
        if (*high != 0 && *max != 0)
            goto update_limits;
    }

    /* Fall back to the limits of the global memory controller. */
    *high = uv__read_uint64("/sys/fs/cgroup/memory/memory.soft_limit_in_bytes");
    *max = uv__read_uint64("/sys/fs/cgroup/memory/memory.limit_in_bytes");

    /* uv__read_uint64 detects cgroup2's "max", so we need to separately detect
     * cgroup1's maximum value (which is derived from LONG_MAX and PAGE_SIZE).
     */
update_limits:
    cgroup1_max = LONG_MAX & ~(sysconf(_SC_PAGESIZE) - 1);
    if (*high == cgroup1_max)
        *high = UINT64_MAX;
    if (*max == cgroup1_max)
        *max = UINT64_MAX;
}

static void uv__get_cgroup2_memory_limits(char buf[1024], uint64_t* high,
    uint64_t* max)
{
    char filename[4097];
    char* p;
    int n;

    /* Find out where the controller is mounted. */
    p = buf + strlen("0::/");
    n = (int)strcspn(p, "\n");

    /* Read the memory limits of the controller. */
    snprintf(filename, sizeof(filename), "/sys/fs/cgroup/%.*s/memory.max", n, p);
    *max = uv__read_uint64(filename);
    snprintf(filename, sizeof(filename), "/sys/fs/cgroup/%.*s/memory.high", n, p);
    *high = uv__read_uint64(filename);
}

static uint64_t uv__get_cgroup_constrained_memory(char buf[1024])
{
    uint64_t high;
    uint64_t max;

    /* In the case of cgroupv2, we'll only have a single entry. */
    if (strncmp(buf, "0::/", 4))
        uv__get_cgroup1_memory_limits(buf, &high, &max);
    else
        uv__get_cgroup2_memory_limits(buf, &high, &max);

    if (high == 0 || max == 0)
        return 0;

    return high < max ? high : max;
}

// TODO: should we cache this? can we?
uint64_t uv_get_constrained_memory()
{
    char buf[1024];

    if (uv__slurp("/proc/self/cgroup", buf, sizeof(buf)))
        return 0;

    return uv__get_cgroup_constrained_memory(buf);
}

#else

uint64_t uv_get_constrained_memory()
{
    return 0;
}

#endif