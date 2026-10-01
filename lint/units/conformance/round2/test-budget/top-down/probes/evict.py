#!/usr/bin/env python3
# Evicts the data pages of every file below the given directories from the page cache (this does not touch dentries or inodes).
import os, sys, time
t0 = time.time()
n = 0
size = 0
for root in sys.argv[1:]:
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            try:
                fd = os.open(p, os.O_RDONLY)
            except OSError:
                continue
            try:
                os.fsync(fd)
                size += os.fstat(fd).st_size
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                n += 1
            finally:
                os.close(fd)
print(f"evicted {n} files, {size} bytes, in {time.time()-t0:.1f} s")
