#!/bin/sh
# Runs the file system slice of bun's portable image on this Mac, once, and says what happened.
#
#     sh run-on-mac.sh
#
# in the directory that misctools/portable/slice/package-macos.ts made: this script, the two images
# (image/), the sources of the host (host/), the program that asks the headers of macOS (verify/) and
# the expected output (expected/). It needs cc (Xcode or the Command Line Tools) and nothing else.
#
# What it does, each step whether or not the one before it went well:
#   1. builds the host with cc. If the part of the host that answers the file system does not
#      compile, it builds the host without that part: the image can still start.
#   2. compiles and runs verify/darwin_layout.c, part by part, and compares what the headers of this
#      macOS say about every structure and constant with what the image has.
#   3. lets the image bind every function of macOS that it can call.
#   4. runs the slice in a directory of its own under this one and compares the output with
#      expected/darwin.jsonl.
#   5. prints a summary of at most 60 lines, and puts everything else into run-on-mac-logs.tar next
#      to this script.
#
# The comparisons are made with sh, cmp, diff, grep and sed. Nothing is written outside of the
# directory of this script.

here=$(cd "$(dirname "$0")" && pwd) || exit 1
cd "$here" || exit 1
logs=$here/logs
build=$here/build
rm -rf "$logs" "$build" "$here/run-on-mac-logs.tar"
mkdir -p "$logs" "$build" || exit 1
summary=$logs/summary.txt
: > "$summary"

say() { printf '%s\n' "$*" >> "$summary"; }
# say_some <file> <most> <what is left out is in>: the first lines of a file, and how many more there are.
say_some() {
  total=$(grep -c '' "$1" 2>/dev/null)
  sed -n "1,$2p" "$1" | sed 's/^/    /' >> "$summary"
  if [ "${total:-0}" -gt "$2" ]; then say "    ... and $((total - $2)) more, in $3"; fi
}
count() { if [ -f "$1" ]; then grep -c '' "$1"; else echo 0; fi; }

# ---- the machine ----
machine=$(uname -m)
case $machine in
  arm64) arch=aarch64 ;;
  x86_64) arch=x86_64 ;;
  *) arch=unknown ;;
esac
image=$here/image/bun_fs_slice-$arch.img
{
  echo "date: $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
  echo "uname -a: $(uname -a)"
  sw_vers 2>&1
  cc --version 2>&1
  echo "page size: $(getconf PAGESIZE 2>&1)"
  echo "directory: $here"
  df . 2>&1
  mount 2>&1
} > "$logs/machine.txt" 2>&1
device=$(df . 2>/dev/null | sed -n '2s/ .*//p')
filesystem=$(mount 2>/dev/null | grep "^$device " | sed -n '1s/^[^(]*(\([^,)]*\).*/\1/p')
say "macOS $(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null)), $machine, page $(getconf PAGESIZE 2>/dev/null), file system ${filesystem:-unknown}"
say "compiler: $(cc --version 2>&1 | sed -n 1p)"
say "package: $(sed -n 1p "$here/package.txt" 2>/dev/null)"
if [ ! -f "$image" ]; then
  say "FAILED: no image for this processor ($machine)"
fi

# ---- 1. the host ----
host=$build/host
host_is=
if cc -O2 -o "$host" "$here/host/host_posix.c" > "$logs/host-build.txt" 2>&1; then
  host_is=whole
  warnings=$(grep -c 'warning:' "$logs/host-build.txt")
  say "1. host: built, $warnings warnings of the compiler"
else
  say "1. host: DOES NOT COMPILE. The first errors (all of them in logs/host-build.txt):"
  grep 'error' "$logs/host-build.txt" > "$logs/host-build-errors.txt"
  say_some "$logs/host-build-errors.txt" 3 logs/host-build.txt
  if cc -O2 -DBUN_HOST_WITHOUT_FILES -o "$host" "$here/host/host_posix.c" > "$logs/host-build-without-files.txt" 2>&1; then
    host_is=without-files
    say "   host without the requests of the file system: built. Steps 2 and 3 run, step 4 cannot pass"
  else
    say "   host without the requests of the file system: does not compile either (logs/host-build-without-files.txt)"
    grep 'error' "$logs/host-build-without-files.txt" > "$logs/host-build-errors-2.txt"
    say_some "$logs/host-build-errors-2.txt" 2 logs/host-build-without-files.txt
  fi
fi
# Whether the host starts the image at all: the image prints how it lays out the definitions of macOS.
image_runs=
if [ -n "$host_is" ] && [ -f "$image" ]; then
  BUN_HOST_TRACE=1 "$host" "$image" --layout-darwin > "$logs/layout-image.jsonl" 2> "$logs/layout-image.err" < /dev/null
  status=$?
  if [ $status -eq 0 ] && [ -s "$logs/layout-image.jsonl" ]; then
    image_runs=yes
  else
    say "   the image DOES NOT START under the host: exit code $status. The end of what it wrote:"
    sed -n '$p' "$logs/layout-image.err" | sed 's/^/    /' | cut -c 1-200 >> "$summary"
  fi
fi

# ---- 2. the layout, from the headers of this macOS ----
: > "$logs/layout-headers.jsonl"
: > "$logs/layout-parts-that-do-not-compile.txt"
parts=0
if cc -DPART=0 -o "$build/part" "$here/verify/darwin_layout.c" > "$logs/layout-part-0.txt" 2>&1; then
  parts=$("$build/part")
fi
n=1
while [ "$n" -le "${parts:-0}" ]; do
  if cc -w -DPART="$n" -o "$build/part" "$here/verify/darwin_layout.c" > "$logs/layout-part.txt" 2>&1; then
    "$build/part" >> "$logs/layout-headers.jsonl"
  else
    what=$(sed -n "s/^$n //p" "$here/verify/parts.txt")
    echo "$what: $(grep 'error' "$logs/layout-part.txt" | sed -n 1p | sed 's/^[^ ]*darwin_layout.c:[0-9:]* //')" >> "$logs/layout-parts-that-do-not-compile.txt"
    { echo "== part $n, $what"; cat "$logs/layout-part.txt"; } >> "$logs/layout-parts.txt"
  fi
  n=$((n + 1))
done
# One fact on each line, "<fact> <of>=<value>", from each side.
facts() { sed -n 's/^{"fact":"\([^"]*\)","of":"\([^"]*\)","value":\(.*\)}$/\1 \2=\3/p' "$1"; }
if [ -n "$image_runs" ]; then
  facts "$logs/layout-image.jsonl" > "$logs/facts-image.txt"
  if ! cmp -s "$logs/layout-image.jsonl" "$here/verify/image-layout-$arch.jsonl"; then
    say "   the image prints another layout here than where it was built (logs/layout-image.jsonl, verify/image-layout-$arch.jsonl)"
  fi
  layout_from="the image, run here"
else
  facts "$here/verify/image-layout-$arch.jsonl" > "$logs/facts-image.txt"
  layout_from="the image, as it was run where it was built"
fi
facts "$logs/layout-headers.jsonl" > "$logs/facts-headers.txt"
: > "$logs/layout-differences.txt"
: > "$logs/layout-not-in-the-headers.txt"
same=0
while IFS= read -r line; do
  name=${line%%=*}
  ours=${line#*=}
  theirs=$(grep -- "^$name=" "$logs/facts-headers.txt" | sed -n "1s/^[^=]*=//p")
  if [ -z "$theirs" ]; then
    echo "$name" >> "$logs/layout-not-in-the-headers.txt"
  elif [ "$theirs" = '"no macro of this name"' ]; then
    echo "$name (the headers have no macro of this name)" >> "$logs/layout-not-in-the-headers.txt"
  elif [ "$ours" = "$theirs" ]; then
    same=$((same + 1))
  else
    echo "$name: $ours in the image, $theirs in the headers" >> "$logs/layout-differences.txt"
  fi
done < "$logs/facts-image.txt"
if [ "${parts:-0}" -eq 0 ]; then
  say "2. layout: verify/darwin_layout.c DOES NOT COMPILE (logs/layout-part-0.txt): $(grep 'error' "$logs/layout-part-0.txt" | sed -n 1p | cut -c 1-160)"
else
  say "2. layout ($layout_from): $same facts are the same, $(count "$logs/layout-differences.txt") DIFFER, $(count "$logs/layout-not-in-the-headers.txt") are not in the headers, $(count "$logs/layout-parts-that-do-not-compile.txt") of $parts parts do not compile"
  say_some "$logs/layout-differences.txt" 8 logs/layout-differences.txt
  say_some "$logs/layout-parts-that-do-not-compile.txt" 3 logs/layout-parts.txt
fi

# ---- 3. the functions of macOS that the image can call ----
if [ -n "$image_runs" ]; then
  BUN_HOST_TRACE=1 "$host" "$image" --imports > "$logs/imports.jsonl" 2> "$logs/imports.err" < /dev/null
  status=$?
  grep '"library":"libSystem"' "$logs/imports.jsonl" | sed -n 's/.*"symbol":"\([^"]*\)","why":"\([^"]*\)".*/\1 (\2)/p' > "$logs/imports-missing.txt"
  totals=$(sed -n 's/^{"step":"imports of macOS","total":\([0-9]*\),"missing":\([0-9]*\).*/\1 functions, \2 missing/p' "$logs/imports.jsonl")
  if [ -z "$totals" ]; then
    say "3. imports: the image DID NOT FINISH, exit code $status: $(sed -n '$p' "$logs/imports.err" | cut -c 1-160)"
  else
    say "3. imports of macOS: $totals"
    say_some "$logs/imports-missing.txt" 6 logs/imports-missing.txt
  fi
else
  say "3. imports: not run, the image does not start"
fi

# ---- 4. the slice ----
: > "$logs/slice-differences.txt"
if [ -n "$image_runs" ]; then
  rm -rf "$here/run-tmp"
  mkdir -p "$here/run-tmp"
  BUN_HOST_TRACE=1 BUN_HOST_COUNTS="$logs/requests.txt" "$host" "$image" run-tmp > "$logs/slice.jsonl" 2> "$logs/slice.err" < /dev/null
  status=$?
  grep '^{"detail"' "$logs/slice.jsonl" > "$logs/slice-details.jsonl"
  # The name of the system call is compared on Linux only.
  grep -v '^{"detail"' "$logs/slice.jsonl" | sed 's/,"syscall":"[^"]*"//' > "$logs/slice-steps.jsonl"
  grep -v '^{"detail"' "$logs/slice.jsonl" > "$logs/slice-steps-with-syscall.jsonl"
  steps=$(count "$logs/slice-steps.jsonl")
  expected=$(count "$here/expected/darwin.jsonl")
  if cmp -s "$logs/slice-steps.jsonl" "$here/expected/darwin.jsonl"; then
    say "4. slice: exit code $status, $steps steps, ALL AS EXPECTED"
  else
    diff "$here/expected/darwin.jsonl" "$logs/slice-steps.jsonl" > "$logs/slice.diff"
    # For every line that is not as expected: the step, bun's name of the error, the number macOS has for it.
    grep '^> ' "$logs/slice.diff" | sed 's/^> //' > "$logs/slice-got.jsonl"
    grep '^< ' "$logs/slice.diff" | sed 's/^< //' > "$logs/slice-wanted.jsonl"
    describe() {
      sed -e 's/^{"step":"\([^"]*\)","path":"\([^"]*\)",\(.*\)}$/\1 [\2]: \3/' -e 's/^{"step":"\([^"]*\)",\(.*\)}$/\1: \2/' \
          -e 's/"ok":false,"error":"\([^"]*\)","errno":\([0-9-]*\)/FAILS with \1, errno \2/' -e 's/"ok":true/ok/' "$1" | cut -c 1-150
    }
    while IFS= read -r line; do
      step=$(printf '%s\n' "$line" | sed 's/^{"step":"\([^"]*\)".*/\1/')
      # With the name of the field, so that a step without a path is found by its name alone.
      path=$(printf '%s\n' "$line" | sed -n 's/^{"step":"[^"]*",\("path":"[^"]*"\).*/\1/p')
      printf '%s\n' "$line" > "$build/one.jsonl"
      echo "got      $(describe "$build/one.jsonl")" >> "$logs/slice-differences.txt"
      grep -F -- "{\"step\":\"$step\"," "$logs/slice-wanted.jsonl" | grep -F -- "$path" | sed -n 1p > "$build/one.jsonl"
      if [ -s "$build/one.jsonl" ]; then
        echo "expected $(describe "$build/one.jsonl")" >> "$logs/slice-differences.txt"
      else
        echo "expected no such step here" >> "$logs/slice-differences.txt"
      fi
      syscall=$(grep -F -- "{\"step\":\"$step\"," "$logs/slice-steps-with-syscall.jsonl" | grep -F -- "$path" | sed -n '1s/.*"syscall":"\([^"]*\)".*/\1/p')
      if [ -n "$syscall" ]; then echo "         bun attributes the error to $syscall" >> "$logs/slice-differences.txt"; fi
    done < "$logs/slice-got.jsonl"
    missing=$(grep -c '' "$logs/slice-wanted.jsonl")
    say "4. slice: exit code $status, $steps steps of $expected, NOT AS EXPECTED: $(count "$logs/slice-got.jsonl") lines are other than expected, $missing expected lines are not there (logs/slice.diff)"
    say_some "$logs/slice-differences.txt" 14 logs/slice-differences.txt
  fi
  grep -v '^\[host\]' "$logs/slice.err" > "$logs/slice-messages.txt"
  if [ -s "$logs/slice-messages.txt" ]; then
    say "   the end of what the image wrote beside its output (logs/slice.err):"
    sed -n '$p' "$logs/slice-messages.txt" | sed 's/^/    /' | cut -c 1-200 >> "$summary"
  fi
  # What the host was asked and refused.
  grep '^refused ' "$logs/requests.txt" 2>/dev/null | sed 's/^refused [0-9-]* \([^ ]*\) \([0-9]*\)/\1 (\2 times)/' > "$logs/requests-refused.txt"
  if [ -s "$logs/requests-refused.txt" ]; then
    say "   requests that the host refused: $(tr '\n' ' ' < "$logs/requests-refused.txt" | cut -c 1-160)"
  fi
  if [ -s "$logs/slice-details.jsonl" ]; then
    say "   how it went on this machine (not compared):"
    sed -e 's/^{"detail":"\([^"]*\)",/\1: /' -e 's/}$//' -e 's/"//g' "$logs/slice-details.jsonl" | cut -c 1-150 > "$logs/slice-details.txt"
    say_some "$logs/slice-details.txt" 5 logs/slice-details.txt
  fi
  rm -rf "$here/run-tmp"
else
  say "4. slice: not run, the image does not start"
fi

# ---- 5. the summary and the logs ----
verdict=PASSED
[ "$host_is" = whole ] || verdict=FAILED
[ -n "$image_runs" ] || verdict=FAILED
[ -s "$logs/layout-differences.txt" ] && verdict=FAILED
[ -s "$logs/layout-parts-that-do-not-compile.txt" ] && verdict=FAILED
[ -s "$logs/imports-missing.txt" ] && verdict=FAILED
[ -f "$logs/imports-missing.txt" ] || verdict=FAILED
cmp -s "$logs/slice-steps.jsonl" "$here/expected/darwin.jsonl" 2>/dev/null || verdict=FAILED
say "$verdict. Everything that was written is in $here/run-on-mac-logs.tar"
rm -rf "$build"
tar -cf "$here/run-on-mac-logs.tar" -C "$here" logs
# At most 60 lines, and the last one is the verdict.
if [ "$(count "$summary")" -gt 60 ]; then
  sed -n '1,58p' "$summary"
  echo "    ... the summary has more lines than 60: the rest is in logs/summary.txt"
  sed -n '$p' "$summary"
else
  cat "$summary"
fi
[ "$verdict" = PASSED ]
