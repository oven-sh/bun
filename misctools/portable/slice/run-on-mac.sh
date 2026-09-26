#!/bin/sh
# Runs the file system slice of bun's portable image on this Mac, once, and says what happened.
#
#     sh run-on-mac.sh
#
# in the directory that misctools/portable/slice/package-macos.ts made: this script, the two images
# (image/), the sources of the host (host/), the program that asks the headers of macOS (verify/) and
# the expected output (expected/). It needs cc (Xcode or the Command Line Tools) and nothing else.
# It takes about a minute.
#
# What it does, each step whether or not the one before it went well:
#   1. builds the host with cc. If the part of the host that answers the file system does not
#      compile, it builds the host without that part: the image can still start.
#   2. compiles and runs verify/darwin_layout.c, part by part, and compares what the headers of this
#      macOS say about every structure and constant with what the image has.
#   3. lets the image bind every function of macOS that it can call.
#   4. runs the slice in a directory of its own under this one and compares the output with
#      expected/darwin.jsonl.
#   5. runs the slice once more on a volume whose file system does not clone (HFS+: a disk image of
#      16 MB that hdiutil makes and mounts under this directory), where bun has to fall back from
#      clonefile to copyfile, and compares with expected/darwin-hfs.jsonl. A Mac that does not
#      let hdiutil do that is not counted as a failure.
#   6. prints a summary of at most 60 lines, and puts everything else into run-on-mac-logs.tar next
#      to this script.
#
# The comparisons are made with sh, cmp, diff, grep and sed. Nothing is written outside of the
# directory of this script, and the volume of step 5 is taken away again. The image gets 120 seconds
# for each of its runs. Control-C ends the run that is going on and skips the steps that are left:
# the summary and the logs are written all the same.

# zsh, when a person runs the script with it: as sh.
if [ -n "${ZSH_VERSION:-}" ]; then emulate sh; fi
here=$(cd "$(dirname "$0")" && pwd) || exit 1
cd "$here" || exit 1
logs=$here/logs
build=$here/build
other=$here/run-tmp-other
seconds=${BUN_RUN_ON_MAC_SECONDS:-120}
rm -rf "$logs" "$build" "$here/run-on-mac-logs.tar" "$here/run-tmp"
mkdir -p "$logs" "$build" || exit 1
summary=$logs/summary.txt
: > "$summary"

# What is printed may have a backslash in it, which echo takes for a command in some shells.
put() { printf '%s\n' "$*"; }
# A line of the summary: at most 200 characters.
say() { printf '%s\n' "$*" | cut -c 1-200 >> "$summary"; }
# say_some <file> <most> <what is left out is in>: the first lines of a file, and how many more there are.
say_some() {
  total=$(grep -c '' "$1" 2>/dev/null)
  sed -n "1,$2p" "$1" | sed 's/^/    /' | cut -c 1-190 >> "$summary"
  if [ "${total:-0}" -gt "$2" ]; then say "    ... and $((total - $2)) more, in $3"; fi
}
count() { if [ -f "$1" ]; then grep -c '' "$1"; else put 0; fi; }
# say_packed <file> <most lines> <what is left out is in>: the lines of a file, as many on a line of the
# summary as it holds.
say_packed() {
  packed=
  printed=0
  taken=0
  total=$(count "$1")
  while IFS= read -r item; do
    if [ -z "$packed" ]; then
      packed=$item
    elif [ $((${#packed} + ${#item} + 2)) -le 186 ]; then
      packed="$packed; $item"
    else
      say "    $packed"
      printed=$((printed + 1))
      packed=$item
      if [ "$printed" -ge "$2" ]; then
        packed=
        break
      fi
    fi
    taken=$((taken + 1))
  done < "$1"
  if [ -n "$packed" ]; then say "    $packed"; fi
  if [ "$taken" -lt "$total" ]; then say "    ... and $((total - taken)) more, in $3"; fi
}

interrupted=
child=
trap 'interrupted=yes; if [ -n "$child" ]; then kill -9 "$child" 2>/dev/null; fi' INT TERM
# limit <command>: runs the command, and ends it when it has run for $seconds.
# The exit code is the one of the command, 137 if it was ended.
limit() {
  "$@" &
  child=$!
  (
    nap=
    trap 'if [ -n "$nap" ]; then kill "$nap" 2>/dev/null; fi; exit 0' TERM
    waited=0
    while [ "$waited" -lt "$seconds" ]; do
      sleep 1 &
      nap=$!
      wait "$nap"
      waited=$((waited + 1))
      kill -0 "$child" 2>/dev/null || exit 0
    done
    kill -9 "$child" 2>/dev/null
  ) > /dev/null 2>&1 &
  watcher=$!
  wait "$child"
  code=$?
  # A signal that this script caught ends the wait, not the command.
  if kill -0 "$child" 2>/dev/null; then
    kill -9 "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  child=
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$code"
}
ended() {
  if [ "$1" -eq 137 ]; then
    put "exit code 137 (it was ended: by this script after $seconds seconds, or by macOS)"
  else
    put "exit code $1"
  fi
}

# ---- the machine ----
machine=$(uname -m)
case $machine in
  arm64) arch=aarch64 ;;
  x86_64) arch=x86_64 ;;
  *) arch=unknown ;;
esac
image=$here/image/bun_fs_slice-$arch.img
device=$(df . 2>/dev/null | sed -n '2s/ .*//p')
filesystem=$(mount 2>/dev/null | grep "^$device " | sed -n '1s/^[^(]*(\([^,)]*\).*/\1/p')
translated=$(sysctl -n sysctl.proc_translated 2>/dev/null)
{
  put "date: $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
  put "uname: $(uname -srm)"
  sw_vers 2>&1
  cc --version 2>&1
  put "page size: $(getconf PAGESIZE 2>&1)"
  put "file system of this directory: ${filesystem:-unknown}"
  put "translated by Rosetta: ${translated:-no}"
} > "$logs/machine.txt" 2>&1
say "macOS $(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null)), $machine, page $(getconf PAGESIZE 2>/dev/null), file system ${filesystem:-unknown}"
if [ "$translated" = 1 ]; then say "this shell runs under Rosetta: the processor is arm64, and everything here is for x86_64"; fi
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
    say "   host without the requests of the file system: built. Steps 2 and 3 run, steps 4 and 5 do not"
  else
    say "   host without the requests of the file system: does not compile either (logs/host-build-without-files.txt)"
    grep 'error' "$logs/host-build-without-files.txt" > "$logs/host-build-errors-2.txt"
    say_some "$logs/host-build-errors-2.txt" 2 logs/host-build-without-files.txt
  fi
fi
# Whether the host starts the image at all: the image prints how it lays out the definitions of macOS.
image_runs=
if [ -n "$host_is" ] && [ -f "$image" ] && [ -z "$interrupted" ]; then
  limit env BUN_HOST_TRACE=1 "$host" "$image" --layout-darwin > "$logs/layout-image.jsonl" 2> "$logs/layout-image.err" < /dev/null
  code=$?
  if [ "$code" -eq 0 ] && [ -s "$logs/layout-image.jsonl" ]; then
    image_runs=yes
  else
    say "   the image DOES NOT START under the host: $(ended "$code"). The end of what it wrote: $(sed -n '$p' "$logs/layout-image.err" | cut -c 1-100)"
  fi
fi

# ---- 2. the layout, from the headers of this macOS ----
: > "$logs/layout-headers.jsonl"
: > "$logs/layout-parts-that-do-not-compile.txt"
parts=0
if [ -z "$interrupted" ] && cc -DPART=0 -o "$build/part" "$here/verify/darwin_layout.c" > "$logs/layout-part-0.txt" 2>&1; then
  parts=$("$build/part")
fi
n=1
while [ "$n" -le "${parts:-0}" ] && [ -z "$interrupted" ]; do
  skip=
  if ! cc -w -DPART="$n" -o "$build/part" "$here/verify/darwin_layout.c" > "$logs/layout-part.txt" 2>&1; then
    # Fields that the headers of this macOS do not have: the part is compiled again without them.
    type=$(sed -n "s/^$n type //p" "$here/verify/parts.txt")
    skip=$(sed -n -e "s/.*error: no member named [^A-Za-z_0-9]*\([A-Za-z_0-9]*\)[^A-Za-z_0-9].*/-DSKIP_${type}_\1/p" \
                  -e "s/.*error: .* has no member named [^A-Za-z_0-9]*\([A-Za-z_0-9]*\)[^A-Za-z_0-9]*$/-DSKIP_${type}_\1/p" "$logs/layout-part.txt" | sort -u | tr '\n' ' ')
    if [ -n "$skip" ]; then
      { put "== part $n, type $type, first attempt"; cat "$logs/layout-part.txt"; } >> "$logs/layout-parts.txt"
      put "$type: $(put "$skip" | sed "s/-DSKIP_${type}_//g")" >> "$logs/layout-fields-not-in-the-headers.txt"
    fi
  fi
  # shellcheck disable=SC2086
  if cc -w $skip -DPART="$n" -o "$build/part" "$here/verify/darwin_layout.c" > "$logs/layout-part.txt" 2>&1; then
    "$build/part" >> "$logs/layout-headers.jsonl"
  else
    what=$(sed -n "s/^$n //p" "$here/verify/parts.txt")
    put "$what: $(grep 'error' "$logs/layout-part.txt" | sed -n 1p | sed 's/^[^ ]*darwin_layout.c:[0-9:]* //')" >> "$logs/layout-parts-that-do-not-compile.txt"
    { put "== part $n, $what"; cat "$logs/layout-part.txt"; } >> "$logs/layout-parts.txt"
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
    put "$name" >> "$logs/layout-not-in-the-headers.txt"
  elif [ "$theirs" = '"no macro of this name"' ]; then
    put "$name (the headers have no macro of this name)" >> "$logs/layout-not-in-the-headers.txt"
  elif [ "$ours" = "$theirs" ]; then
    same=$((same + 1))
  else
    put "$name: $ours in the image, $theirs in the headers" >> "$logs/layout-differences.txt"
  fi
done < "$logs/facts-image.txt"
# The constants that the headers do not have come first: they are names, the rest belongs to a part.
grep 'no macro of this name' "$logs/layout-not-in-the-headers.txt" > "$build/not-in-the-headers.txt"
grep -v 'no macro of this name' "$logs/layout-not-in-the-headers.txt" >> "$build/not-in-the-headers.txt"
cp "$build/not-in-the-headers.txt" "$logs/layout-not-in-the-headers.txt"
if [ ! -f "$logs/layout-part-0.txt" ]; then
  say "2. layout: not run"
elif [ "${parts:-0}" -eq 0 ]; then
  say "2. layout: verify/darwin_layout.c DOES NOT COMPILE (logs/layout-part-0.txt): $(grep 'error' "$logs/layout-part-0.txt" | sed -n 1p | sed 's/^[^ ]*darwin_layout.c:[0-9:]* //')"
else
  say "2. layout ($layout_from): $same facts are the same, $(count "$logs/layout-differences.txt") DIFFER, $(count "$logs/layout-not-in-the-headers.txt") are not in the headers, $(count "$logs/layout-parts-that-do-not-compile.txt") of $parts parts do not compile"
  say_packed "$logs/layout-differences.txt" 5 logs/layout-differences.txt
  say_packed "$logs/layout-not-in-the-headers.txt" 2 logs/layout-not-in-the-headers.txt
  say_some "$logs/layout-parts-that-do-not-compile.txt" 2 logs/layout-parts.txt
  if [ -s "$logs/layout-fields-not-in-the-headers.txt" ]; then
    say "   fields that the headers of this macOS do not have: $(tr '\n' ';' < "$logs/layout-fields-not-in-the-headers.txt" | cut -c 1-140)"
  fi
fi

# ---- 3. the functions of macOS that the image can call ----
if [ -n "$image_runs" ] && [ -z "$interrupted" ]; then
  limit env BUN_HOST_TRACE=1 "$host" "$image" --imports > "$logs/imports.jsonl" 2> "$logs/imports.err" < /dev/null
  code=$?
  # The names, each once, and why they were not bound, which is one reason for all of them as a rule.
  grep '"library":"libSystem"' "$logs/imports.jsonl" | sed -n 's/.*"symbol":"\([^"]*\)","why":"[^"]*".*/\1/p' | sort -u > "$logs/imports-missing.txt"
  why=$(grep '"library":"libSystem"' "$logs/imports.jsonl" | sed -n 's/.*"symbol":"[^"]*","why":"\([^"]*\)".*/\1/p' | sort -u | tr '\n' ';' | sed -e 's/;$//' -e 's/;/; /g')
  totals=$(sed -n 's/^{"step":"imports of macOS","total":\([0-9]*\),"missing":\([0-9]*\).*/\1 functions, \2 missing/p' "$logs/imports.jsonl")
  if [ -z "$totals" ]; then
    rm -f "$logs/imports-missing.txt"
    say "3. imports: the image DID NOT FINISH, $(ended "$code"): $(sed -n '$p' "$logs/imports.err" | cut -c 1-160)"
  else
    say "3. imports of macOS: $totals${why:+ ($why)}"
    say_packed "$logs/imports-missing.txt" 4 logs/imports-missing.txt
  fi
else
  say "3. imports: not run"
fi

# ---- 4 and 5. the slice ----
# A line of the output as a person reads it: the step, and how it ended.
describe() {
  sed -e 's/^{"step":"\([^"]*\)","path":"\([^"]*\)",\(.*\)}$/\1 [\2]: \3/' -e 's/^{"step":"\([^"]*\)",\(.*\)}$/\1: \2/' \
      -e 's/"ok":false,"error":"\([^"]*\)","errno":\([0-9-]*\)/FAILS with \1, errno \2/' -e 's/"ok":true/ok/'
}
# slice <number> <directory, from here> <expected output> <name of the logs> <most lines of differences>
slice() {
  number=$1
  directory=$2
  wanted=$3
  name=$4
  most=$5
  limit env BUN_HOST_TRACE=1 BUN_HOST_COUNTS="$logs/$name-requests.txt" "$host" "$image" "$directory" > "$logs/$name.jsonl" 2> "$logs/$name.err" < /dev/null
  code=$?
  grep '^{"detail"' "$logs/$name.jsonl" > "$logs/$name-details.jsonl"
  # The name of the system call is compared on Linux only.
  grep -v '^{"detail"' "$logs/$name.jsonl" | sed 's/,"syscall":"[^"]*"//' > "$logs/$name-steps.jsonl"
  # After a step that failed in a function of macOS comes what macOS itself said: on the line of its step.
  sed 's/,"syscall":"[^"]*"//' "$logs/$name.jsonl" |
    sed -e ':a' -e '$!N' -e 's/\n{"detail":"error number of the last call of macOS","errno":\([0-9-]*\)}$/ MACOS \1/' -e 'ta' -e 'P' -e 'D' > "$logs/$name-said.txt"
  : > "$logs/$name-differences.txt"
  steps=$(count "$logs/$name-steps.jsonl")
  if cmp -s "$logs/$name-steps.jsonl" "$wanted"; then
    say "$number. slice in $directory: $(ended "$code"), $steps steps, ALL AS EXPECTED"
  else
    # diff is for the person who reads the logs: its output is not the same with every diff. The lines
    # that are on one side only are found by grep, as whole lines and letter by letter.
    diff "$wanted" "$logs/$name-steps.jsonl" > "$logs/$name.diff"
    grep -F -x -v -f "$wanted" "$logs/$name-steps.jsonl" > "$logs/$name-got.jsonl"
    grep -F -x -v -f "$logs/$name-steps.jsonl" "$wanted" > "$logs/$name-wanted.jsonl"
    while IFS= read -r line; do
      step=$(printf '%s\n' "$line" | sed 's/^{"step":"\([^"]*\)".*/\1/')
      # With the name of the field, so that a step without a path is found by its name alone.
      of_path=$(printf '%s\n' "$line" | sed -n 's/^{"step":"[^"]*",\("path":"[^"]*"\).*/\1/p')
      grep -F -- "{\"step\":\"$step\"," "$logs/$name-wanted.jsonl" > "$build/wanted.jsonl"
      if [ -n "$of_path" ]; then
        grep -F -- "$of_path" "$build/wanted.jsonl" > "$build/wanted-of-path.jsonl"
        mv "$build/wanted-of-path.jsonl" "$build/wanted.jsonl"
      fi
      expected=$(sed -n 1p "$build/wanted.jsonl" | describe | sed 's/^[^:]*: //')
      said=$(grep -F -- "$line MACOS " "$logs/$name-said.txt" | sed -n '1s/.* MACOS \([0-9-]*\)$/; macOS itself said errno \1/p')
      syscall=$(grep -F -- "{\"step\":\"$step\"," "$logs/$name.jsonl" | sed -n '1s/.*"syscall":"\([^"]*\)".*/; bun names the call \1/p')
      put "$(printf '%s\n' "$line" | describe)$said$syscall <- EXPECTED: ${expected:-no such step}" >> "$logs/$name-differences.txt"
    done < "$logs/$name-got.jsonl"
    # Steps that are expected and did not come at all.
    while IFS= read -r line; do
      step=$(printf '%s\n' "$line" | sed 's/^{"step":"\([^"]*\)".*/\1/')
      if ! grep -q -F -- "{\"step\":\"$step\"," "$logs/$name-got.jsonl"; then
        put "(the step did not come) <- EXPECTED: $(printf '%s\n' "$line" | describe)" >> "$logs/$name-differences.txt"
      fi
    done < "$logs/$name-wanted.jsonl"
    if [ ! -s "$logs/$name-differences.txt" ]; then
      put "the lines that are expected, in another order or one of them twice" >> "$logs/$name-differences.txt"
    fi
    say "$number. slice in $directory: $(ended "$code"), $steps steps of $(count "$wanted"), NOT AS EXPECTED in $(count "$logs/$name-differences.txt") (logs/$name.diff)"
    say_some "$logs/$name-differences.txt" "$most" "logs/$name-differences.txt"
  fi
  grep -v '^\[host\]' "$logs/$name.err" > "$logs/$name-messages.txt"
  if [ -s "$logs/$name-messages.txt" ]; then
    say "   the end of what the image wrote beside its output (logs/$name.err): $(sed -n '$p' "$logs/$name-messages.txt" | cut -c 1-150)"
  fi
  # What the host was asked and refused.
  grep '^refused ' "$logs/$name-requests.txt" 2>/dev/null | sed 's/^refused [0-9-]* \([^ ]*\) \([0-9]*\)/\1 (\2 times)/' > "$logs/$name-requests-refused.txt"
  if [ -s "$logs/$name-requests-refused.txt" ]; then
    say "   requests that the host refused: $(tr '\n' ' ' < "$logs/$name-requests-refused.txt" | cut -c 1-160)"
  fi
  # How the copies were made: by clonefile, or by copyfile after clonefile was refused.
  sed -n -e 's/^{"detail":"clonefile[^"]*","way":"clonefile"}$/clonefile/p' \
         -e 's/^{"detail":"clonefile[^"]*","way":"copyfile","clonefile was refused with":"\([^"]*\)","errno":\([0-9-]*\)}$/copyfile, after clonefile was refused with \1 (errno \2 of macOS)/p' \
         "$logs/$name-details.jsonl" | sort -u > "$logs/$name-ways.txt"
  if [ -s "$logs/$name-ways.txt" ]; then
    say "   the copies were made by: $(tr '\n' ';' < "$logs/$name-ways.txt" | sed -e 's/;$//' -e 's/;/; /g' | cut -c 1-170)"
  fi
}

if [ -n "$image_runs" ] && [ "$host_is" = whole ] && [ -z "$interrupted" ]; then
  mkdir -p "$here/run-tmp"
  slice 4 run-tmp "$here/expected/darwin.jsonl" slice 12
  rm -rf "$here/run-tmp"
else
  say "4. slice: not run"
fi

# A volume of its own, with a file system that does not clone.
other_volume=
if [ -n "$image_runs" ] && [ "$host_is" = whole ] && [ -z "$interrupted" ]; then
  if ! command -v hdiutil > /dev/null 2>&1; then
    say "5. slice on a volume that does not clone: not run, there is no hdiutil"
  elif hdiutil create -size 16m -fs HFS+ -volname bun-slice -o "$build/other.dmg" > "$logs/other-volume.txt" 2>&1 &&
    mkdir -p "$other" && hdiutil attach "$build/other.dmg" -nobrowse -mountpoint "$other" >> "$logs/other-volume.txt" 2>&1; then
    other_volume=mounted
    slice 5 run-tmp-other "$here/expected/darwin-hfs.jsonl" slice-other 6
    if ! grep -q 'copyfile' "$logs/slice-other-ways.txt" 2>/dev/null; then
      say "   NO COPY was made by copyfile: the volume cloned, or the steps of clonefile did not run"
      put "no copy by copyfile" >> "$logs/slice-other-differences.txt"
    fi
    if hdiutil detach "$other" -force >> "$logs/other-volume.txt" 2>&1; then
      other_volume=detached
      rmdir "$other" 2>/dev/null
    else
      say "   THE VOLUME IS STILL MOUNTED at $other. To take it away: hdiutil detach '$other' -force"
    fi
  else
    say "5. slice on a volume that does not clone: not run, hdiutil did not make the volume: $(sed -n '$p' "$logs/other-volume.txt" | cut -c 1-110)"
    rmdir "$other" 2>/dev/null
  fi
else
  say "5. slice on a volume that does not clone: not run"
fi

# ---- 6. the summary and the logs ----
verdict=PASSED
[ "$host_is" = whole ] || verdict=FAILED
[ -n "$image_runs" ] || verdict=FAILED
[ -z "$interrupted" ] || verdict=FAILED
[ -s "$logs/layout-differences.txt" ] && verdict=FAILED
[ -s "$logs/layout-not-in-the-headers.txt" ] && verdict=FAILED
[ -s "$logs/layout-parts-that-do-not-compile.txt" ] && verdict=FAILED
[ -s "$logs/layout-fields-not-in-the-headers.txt" ] && verdict=FAILED
[ -s "$logs/imports-missing.txt" ] && verdict=FAILED
[ -f "$logs/imports-missing.txt" ] || verdict=FAILED
cmp -s "$logs/slice-steps.jsonl" "$here/expected/darwin.jsonl" 2>/dev/null || verdict=FAILED
if [ -n "$other_volume" ]; then
  cmp -s "$logs/slice-other-steps.jsonl" "$here/expected/darwin-hfs.jsonl" 2>/dev/null || verdict=FAILED
  [ -s "$logs/slice-other-differences.txt" ] && verdict=FAILED
  [ "$other_volume" = detached ] || verdict=FAILED
fi
if [ -n "$interrupted" ]; then say "the run was interrupted: the steps that were left did not run"; fi
say "$verdict. Everything that was written is in $here/run-on-mac-logs.tar"
rm -rf "$build"
# Without the files that the tar of macOS adds for what a file has beside its bytes.
COPYFILE_DISABLE=1 tar -cf "$here/run-on-mac-logs.tar" -C "$here" logs
# At most 60 lines, and the last one is the verdict.
if [ "$(count "$summary")" -gt 60 ]; then
  sed -n '1,58p' "$summary"
  put "    ... the summary has more lines than 60: the rest is in logs/summary.txt"
  sed -n '$p' "$summary"
else
  cat "$summary"
fi
[ "$verdict" = PASSED ]
