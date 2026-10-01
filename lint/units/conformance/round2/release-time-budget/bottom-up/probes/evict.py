#!/usr/bin/env python3
# usage: evict.py <directory>: writes back and drops the page cache of every file below it (not the dentries).
import os, sys
n = 0
for root, dirs, files in os.walk(sys.argv[1]):
    for name in files:
        p = os.path.join(root, name)
        try:
            fd = os.open(p, os.O_RDONLY)
        except OSError:
            continue
        try:
            os.fsync(fd)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            n += 1
        finally:
            os.close(fd)
print("evicted", n, "files")
