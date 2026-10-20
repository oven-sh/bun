#!/bin/bash
# usage: sys.sh <bun-binary> <css>  → file syscall counts (qemu -strace)
BIN=$1; CSS=$2
D=$(mktemp -d)
qemu-x86_64 -strace -D "$D/log" "$BIN" build "$CSS" --outdir "$D/out" > "$D/stdout" 2>&1
echo "$(grep -cE ' (openat|open|read|pread64|write|pwrite64|writev|close|statx|newfstatat|fstat|lseek|readlink|getdents64|mkdirat|renameat|unlinkat|ftruncate|fallocate|copy_file_range|sendfile)\(' "$D/log") $(grep -cE ' (openat|open)\(' "$D/log") $(grep -cE ' (read|pread64)\(' "$D/log") $(grep -cE ' (statx|newfstatat|fstat)\(' "$D/log")"
rm -rf "$D"
