#!/bin/sh
# Runs the tests of one architecture, each of them several times. build.sh comes first.
#
#   test/run.sh [x86_64|aarch64] [runs] [out dir]     default: x86_64, 5, out/<arch>
#
# Prints one line for each test, "<name>: <passes> of <runs>", and fails if
# a run failed. A test passes with exit code 42 and the expected line of output.
# The aarch64 tests also run copies of the image and of the host in which
# instructions are replaced (test/rewrite_insn.py):
#   - traps in place of the instructions that the mode under test must not run
#   - "must fail" runs, which show that those traps and the x18 reload are real
# The x86_64 host ends the process when code outside of the host issues a syscall (seccomp),
# so every hosted x86_64 run that passes issued none. The "must fail" run of raw_syscall.img
# shows that the filter is real. The hosted x86_64 tests run three times: as they are, with
# the memory model of the Windows host (BUN_HOST_TEST=winmem) and with MADV_DONTNEED done the
# way of the macOS branch (BUN_HOST_TEST=overlay).
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
arch=x86_64
case "${1:-}" in
  x86_64 | aarch64) arch=$1; shift ;;
esac
runs=${1:-5}
out=${2:-$here/out/$arch}
out=$(cd "$out" && pwd) || exit 2
run=
[ "$(uname -m)" = "$arch" ] || run=qemu-$arch
ulimit -c 0
failed=0
log=$out/test.log
m2="^m2: threads=8 total=204263652 thread_locals_ok=8/8 main_tls=unset file_roundtrip=1 wall_year_ok=1 pid_ok=1 "

# expect <exit code> <pattern of the output> <name> <command>
expect() {
  want=$1 pattern=$2 name=$3
  shift 3
  passes=0
  i=0
  while [ $i -lt "$runs" ]; do
    i=$((i + 1))
    "$@" >"$log" 2>&1
    status=$?
    if [ $status -eq "$want" ] && grep -q "$pattern" "$log"; then
      passes=$((passes + 1))
    else
      echo "  $name: run $i: exit code $status, wanted $want. Output:"
      sed 's/^/    /' "$log"
    fi
  done
  echo "$name: $passes of $runs"
  [ $passes -eq "$runs" ] || failed=1
}

paths="vfork=1 signal=1 cancel=1 main_tls=7 stack=1 mask=1 thread_signal=1 fault=1 maperr=1 tls_align=1"
expect 42 "^memory_model: .* 0 failures" "memory model (host/memory.h) against a page by page description" "$out/memory_model" 100000 "$$"
expect 42 "$m2" "$arch threads direct" $run "$out/threads.img" "$out/probe.tmp"
expect 42 "$m2" "$arch threads hosted" $run "$out/host-linux" "$out/threads.img" "$out/probe.tmp"
expect 42 "^linux_paths: mode=direct $paths" "$arch linux_paths direct" $run "$out/linux_paths.img" direct
expect 42 "^requests: mode=direct checks=[0-9]* failures=0" "$arch requests direct" $run "$out/requests.img" direct "$out/requests.tmp"

if [ "$arch" = x86_64 ]; then
  if bun "$here/test/check_x86_64.ts" "$out" --image "$out/threads.img" --image "$out/linux_paths.img" >"$log" 2>&1; then
    echo "x86_64 static checks of sysroot and images: passed"
  else
    echo "x86_64 static checks of sysroot and images: FAILED"
    sed 's/^/    /' "$log"
    failed=1
  fi
  if bun "$here/test/check_x86_64.ts" "$out" --image "$out/raw_syscall.img" >"$log" 2>&1 || ! grep -q "raw_syscall.img: main: has syscall and does not read __bun_host.os" "$log"; then
    echo "x86_64 must fail: static checks of an image that issues a syscall itself: NOT REPORTED"
    sed 's/^/    /' "$log"
    failed=1
  else
    echo "x86_64 must fail: static checks of an image that issues a syscall itself: reported"
  fi
  expect 42 "^linux_paths: mode=hosted-signals $paths" "x86_64 linux_paths hosted" "$out/host-linux" "$out/linux_paths.img" hosted-signals
  expect 42 "^requests: mode=hosted checks=[0-9]* failures=0" "x86_64 requests hosted" "$out/host-linux" "$out/requests.img" hosted "$out/requests.tmp"
  for way in winmem overlay; do
    expect 42 "^requests: mode=hosted checks=[0-9]* failures=0" "x86_64 requests hosted, $way" env BUN_HOST_TEST=$way "$out/host-linux" "$out/requests.img" hosted "$out/requests.tmp"
    expect 42 "$m2" "x86_64 threads hosted, $way" env BUN_HOST_TEST=$way "$out/host-linux" "$out/threads.img" "$out/probe.tmp"
    expect 42 "^linux_paths: mode=hosted-signals $paths" "x86_64 linux_paths hosted, $way" env BUN_HOST_TEST=$way "$out/host-linux" "$out/linux_paths.img" hosted-signals
  done
  expect 42 "^raw_syscall: the kernel answered" "x86_64 raw_syscall direct" "$out/raw_syscall.img"
  expect 99 "^host: the image issued syscall 39 itself, at image offset" "x86_64 must fail: hosted, image that issues a syscall itself" "$out/host-linux" "$out/raw_syscall.img"
  expect 42 "^raw_syscall: the kernel answered" "x86_64 control: the same without the filter of the host" env BUN_HOST_SECCOMP=0 "$out/host-linux" "$out/raw_syscall.img"
fi

if [ "$arch" = aarch64 ]; then
  expect 42 "^requests: mode=hosted-quiet checks=[0-9]* failures=0" "aarch64 requests hosted" $run "$out/host-linux" "$out/requests.img" hosted-quiet "$out/requests.tmp"
  if python3 "$here/test/check_aarch64.py" "$out" >"$log" 2>&1; then
    echo "aarch64 static checks of sysroot and images: passed"
  else
    echo "aarch64 static checks of sysroot and images: FAILED"
    sed 's/^/    /' "$log"
    failed=1
  fi
  for image in threads linux_paths; do
    if python3 "$here/test/check_signature.py" "$out/$image.img" >"$log" 2>&1; then
      echo "aarch64 $image.img: the appended Apple code signature is well formed and its hashes match"
    else
      echo "aarch64 $image.img: Apple code signature check FAILED"
      sed 's/^/    /' "$log"
      failed=1
    fi
  done
  v=$out/variants
  mkdir -p "$v"
  rewrite() { python3 "$here/test/rewrite_insn.py" "$@" >/dev/null && chmod +x "$2"; }
  rewrite "$out/threads.img" "$v/threads.linux-only.img" no-x18 no-tpidrro
  rewrite "$out/threads.img" "$v/threads.x18-only.img" no-svc no-tpidr no-tpidrro
  rewrite "$out/linux_paths.img" "$v/linux_paths.linux-only.img" no-x18 no-tpidrro
  rewrite "$out/linux_paths.img" "$v/linux_paths.x18-only.img" no-svc no-tpidr no-tpidrro
  rewrite "$out/linux_paths.img" "$v/linux_paths.tpidrro-only.img" no-svc no-tpidr no-x18
  rewrite "$out/host-linux" "$v/host-linux.no-x18-reload" no-x18-reload

  expect 42 "$m2" "aarch64 threads direct, traps on the x18 and tpidrro_el0 paths" $run "$v/threads.linux-only.img" "$out/probe.tmp"
  expect 42 "$m2" "aarch64 threads hosted (x18), traps on svc, tpidr_el0, tpidrro_el0" $run "$out/host-linux" "$v/threads.x18-only.img" "$out/probe.tmp"
  expect 42 "^linux_paths: mode=direct $paths" "aarch64 linux_paths direct, traps on the x18 and tpidrro_el0 paths" $run "$v/linux_paths.linux-only.img" direct
  expect 42 "^linux_paths: mode=hosted $paths" "aarch64 linux_paths hosted (x18), traps on svc, tpidr_el0, tpidrro_el0" $run "$out/host-linux" "$v/linux_paths.x18-only.img" hosted
  expect 42 "^linux_paths: mode=hosted $paths" "aarch64 linux_paths hosted (tpidrro_el0, one thread), traps on svc, tpidr_el0, x18" env BUN_HOST_TEST=macos-tp $run "$out/host-linux" "$v/linux_paths.tpidrro-only.img" hosted

  # 132 is SIGILL. A host whose shims do not put x18 back is ended by its own check of x18
  # (exit code 96): the next request finds what the host left in the register.
  expect 96 "^host: the image changed x18: it is 0xdead" "aarch64 must fail: hosted, host does not reload x18" $run "$v/host-linux.no-x18-reload" "$out/threads.img" "$out/probe.tmp"
  expect 132 "Illegal instruction" "aarch64 must fail: direct, image with traps on svc" $run "$v/threads.x18-only.img" "$out/probe.tmp"
  expect 132 "Illegal instruction" "aarch64 must fail: hosted (x18), image with traps on x18" $run "$out/host-linux" "$v/threads.linux-only.img" "$out/probe.tmp"
  expect 132 "Illegal instruction" "aarch64 must fail: hosted (tpidrro_el0), image with traps on tpidrro_el0" env BUN_HOST_TEST=macos-tp $run "$out/host-linux" "$v/linux_paths.x18-only.img" hosted
fi
rm -f "$log"
exit $failed
