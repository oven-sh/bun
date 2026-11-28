#!/bin/sh
# usage: tools/asm.sh <binary or object> <regex on the demangled symbol>
# The targets of jumps within a function have labels: .1, .2 and so on. A jump to a label above it closes a loop.
# PLAIN=1 leaves them as they are.
[ -z "${PLAIN:-}" ] || { $(dirname "$0")/objdump.sh "$1" $(file "$1" | grep -q -E 'x86-64|80386|i386' && echo "-M intel") | awk -v re="$2" '/^<.*>:$/ {p = ($0 ~ re)} p && NF'; exit; }
ADDRESSES=1 $(dirname "$0")/objdump.sh "$1" $(file "$1" | grep -q -E 'x86-64|80386|i386' && echo "-M intel") | awk -v re="$2" '
  function flush(  i, n, to, text) {
    for (i = 1; i <= lines; i++) if (match(line[i], /0x[0-9a-f]+ <.*>$/) && (to = substr(line[i], RSTART + 2, index(substr(line[i], RSTART), " ") - 3)) in place) wanted[to] = 1
    for (i = 1; i <= lines; i++) if (at[i] in wanted) label[at[i]] = "." ++n
    for (i = 1; i <= lines; i++) {
      if (at[i] in label) print label[at[i]] ":"
      text = line[i]
      if (match(text, /0x[0-9a-f]+ <.*>$/) && (to = substr(text, RSTART + 2, index(substr(text, RSTART), " ") - 3)) in label) text = substr(text, 1, RSTART - 1) label[to]
      print text
    }
    lines = 0; split("", place); split("", wanted); split("", label)
  }
  /^[0-9a-f]+ <.*>:$/ { flush(); sub(/^[0-9a-f]+ /, ""); p = ($0 ~ re); if (p) { print; found = 1 }; next }
  p && NF { a = $1; sub(/:$/, "", a); sub(/^ *[0-9a-f]+: */, ""); at[++lines] = a; place[a] = 1; line[lines] = $0 }
  END { flush(); exit !found }' && exit
echo "no function matches. A kernel for the baseline can be inlined into its callers" >&2; exit 1
