#!/bin/bash
# this_programs.sh <bun> <work folder> [<file that lists programs>]
#
# A typed version gives a constructor function its type by declaring `this`: `function FiberNode(this: Fiber, tag: WorkTag) { .. }`.
# This builds and runs every program of test/aot/programs that is one file and declares `this` on a function, 20 at a time, and
# compares what it prints as test/aot/run-programs.ts does: with its .expected.txt, or else with plain Bun.
# <bun> is a build of Bun that has --aot. A list names programs by their paths below test/aot/programs, one a line.
#
# Prints how many programs ended in each way, then the programs that failed. <work folder>/results.txt has a line for each program:
#   ok       It printed what was expected.
#   DIFFERS  It printed something else: compare <work folder>/<program>.told with .wanted.
#   KILLED   A signal ended it, or it ran for more than 60 seconds.
#   BUILD    It was not built: see <work folder>/<program>.build.
#   todo     It has a .todo.txt. Not built.
#   skip     It has a .build-errors.txt, or a .json with flags of its own. Not built.
set -u
export NO_COLOR=1 BUN_ENABLE_CRASH_REPORTING=0

[ $# -ge 2 ] || { echo "usage: this_programs.sh <bun> <work folder> [<file that lists programs>]"; exit 2; }
command -v timeout > /dev/null || { echo "this_programs.sh: needs timeout, of the GNU coreutils"; exit 2; }
BUN="$(readlink -f "$1")"
mkdir -p "$2"; WORK="$(cd "$2" && pwd)"
PROGRAMS="$(cd "$(dirname "$0")/../../../test/aot/programs" && pwd)"
if [ -n "${3-}" ]; then
  list="$(cat "$3")"
else
  list="$(cd "$PROGRAMS" && grep -rlE 'function \w*\(this: ' . | sed 's,^\./,,' | awk -F/ 'NF == 2' | grep -E '\.tsx?$' | sort)"
fi

# told <stdout> <stderr> <exit code>: the parts of a run that have to be the same, in the form of an .expected.txt.
told() {
  sed -E 's/ [0-9]+ms$//' "$1"
  if [ "$3" -eq 0 ]; then
    cat "$2"
  else
    echo "exit code $3"
    grep -m1 -E '^(error|[A-Za-z]*Error)\b' "$2" || echo
  fi
}

run_program() {
  local program="$1" beside="$PROGRAMS/${1%.*}" out="$WORK/$(echo "$1" | tr / _)" code
  [ -e "$beside.todo.txt" ] && { echo "todo $program"; return; }
  [ -e "$beside.build-errors.txt" ] || [ -e "$beside.json" ] && { echo "skip $program"; return; }
  cd "$(dirname "$PROGRAMS/$program")" || return
  timeout 120 "$BUN" build --compile --aot "$PROGRAMS/$program" --outfile "$out" < /dev/null > "$out.build" 2>&1 || { echo "BUILD $program"; return; }
  timeout 60 "$out" < /dev/null > "$out.stdout" 2> "$out.stderr"; code=$?
  rm -f "$out"
  [ $code -ge 124 ] && { echo "KILLED $program"; return; }
  told "$out.stdout" "$out.stderr" $code > "$out.told"
  if [ -e "$beside.expected.txt" ]; then
    cp "$beside.expected.txt" "$out.wanted"
  else
    timeout 60 "$BUN" run "$PROGRAMS/$program" < /dev/null > "$out.plain.stdout" 2> "$out.plain.stderr"
    told "$out.plain.stdout" "$out.plain.stderr" $? > "$out.wanted"
  fi
  if cmp -s "$out.told" "$out.wanted"; then echo "ok $program"; else echo "DIFFERS $program"; fi
}
export -f told run_program
export BUN WORK PROGRAMS

echo "$list" | xargs -P 20 -I{} bash -c 'run_program {}' 2> /dev/null | sort -k2 > "$WORK/results.txt"
cut -d' ' -f1 "$WORK/results.txt" | sort | uniq -c | tr '\n' ' '; echo
! grep -E '^(BUILD|DIFFERS|KILLED) ' "$WORK/results.txt"
