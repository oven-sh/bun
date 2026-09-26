# Common settings for the portable-ABI spike. Source this file.
export LLVM_BIN=/usr/lib/llvm-current/bin
export SYSROOT=/tmp/portable/sysroot
export JSCDIR=/tmp/portable/jsc
export PTARGET=x86_64-linux-musl
# The portable ABI compile flags (the task's flag set).
export PORTABLE_ABI_FLAGS="-femulated-tls -mno-red-zone -fPIE"
export JOBS=8
