#!/bin/bash
# wide1.sh build | answers <a whole Bun that knows --aot> <room> [<name>=<folder with seroval.ts> ..]: THE WIDE TREE OF seroval (wide.ts: 19 scenarios of the public API): fizz/judge/wide2.sh's way. IT IS NOT React: `answers` RUNS PACKAGE CODE: THE BUILD MACHINE, IN THE JAIL. `build` runs none.
# NODE_MODULES=<a node_modules that holds seroval 1.6.9 and @types/node>: seroval, @types/node and undici-types are COPIED into each column.
# THE LAID FILE IS NAMED index.sound.ts, NOT index.ts: BESIDE index.js THE CHECKER TAKES index.ts AHEAD OF THE AUTHORS' index.d.ts: THE PACKAGE's PUBLIC TYPES (deserialize<T>() ..) WOULD BE SHADOWED BY THE TYPED TEXT's AND A USER's PROGRAM WOULD STOP WITH TYPE ERRORS (make1's first build, 18:46: TS2558 x 5 in the wide tree). SO: importers see the authors' declaration file; the code is the typed text: as with React (@types | cjs/*.production.ts).
# build: untyped (the package as it is) and, for each name: typed + typed.audit (AUDIT=1): <folder>/seroval.ts -> seroval/dist/index.sound.ts; seroval/dist/index.js = `export * from "./index.sound.ts";`. THE md5 OF npm's index.js IS ASSERTED (ccbd0950). A LAID FILE WITH A TYPE ERROR UNDER --strict IS NOT BUILT (SEMA=<front end>; UNCHECKED=1 goes without). A `TS100009` in a build's log is said and fails the column.
# AND A THIRD TIME: <column>.doors: wide.ts whole, with carry() out of the untyped carried.js behind `carry<T>(x: T): T`: THE NODES ARE LAID OUT *AND* PLAIN TREES ARRIVE AT THE DOORS (compileJSON, fromJSON, fromCrossJSON): what differs from plain there is what the doors cost in answers.
# EVERY COLUMN IS BUILT TWICE: <column> from wide.ts (trees come in from outside too: SerovalNode is GIVEN by its looks: no layout) AND <column>.born from <column>.born/wide.ts (= wide.ts less what stands between /*C*/ marks; a folder of its own, so that the first program's file is not in the second's project: the nodes ARE laid out, as in a server's program): each is compared with its own source run plainly.
# answers: the same source plainly, twice (determinacy), then every column, compared scenario by scenario; the audit's `AOT:` lines by kind. A head that begins `== 98 ` | `== 99 ` is KNOWN TO DIFFER: shown, not counted.
set -u
export NO_COLOR=1 BUN_ENABLE_CRASH_REPORTING=0 NODE_ENV=production TZ=America/Los_Angeles
STEP="$1"; BUN="$2"; W="$3"; shift 3; HERE="$(cd "$(dirname "$0")" && pwd)"; WIDE=${WIDE:-$HERE/wide}; [ -d "$WIDE" ] || WIDE="$HERE/../trees/seroval"
if [ "$(uname)" = Darwin ]; then N=${NODE_MODULES:?NODE_MODULES=<a node_modules that holds seroval 1.6.9 and @types/node>}; md() { md5 -q "$1"; }; else N=${NODE_MODULES:?NODE_MODULES=<a node_modules that holds seroval 1.6.9 and @types/node>}; md() { md5sum "$1" | cut -c1-32; }; fi
if [ "$STEP" = build ]; then mkdir -p "$W/out"; : > "$W/columns"
  [ "$(md "$N/seroval/dist/index.js" | cut -c1-8)" = ccbd0950 ] || { echo "wide1.sh: seroval/dist/index.js is $(md "$N/seroval/dist/index.js" | cut -c1-8): the text was typed on ccbd0950"; exit 1; }
  tree1() { mkdir -p "$W/$1/node_modules/@types"; cp "$WIDE/tsconfig.json" "$W/$1/"; cp -R "$N/seroval" "$W/$1/node_modules/seroval"; cp -R "$N/@types/node" "$W/$1/node_modules/@types/node"; [ -d "$N/undici-types" ] && cp -R "$N/undici-types" "$W/$1/node_modules/undici-types"; }
  tree() { tree1 "$1"; cp "$WIDE/wide.ts" "$W/$1/"; tree1 "$1.born"; tree1 "$1.doors"; cp "$WIDE/carried.js" "$WIDE/carried.d.ts" "$W/$1.doors/"
    python3 -c 'import re,sys; t=open(sys.argv[1]).read(); open(sys.argv[2],"w").write(re.sub(r"/\*C\*/.*?/\*C\*/", "", t, flags=re.S)); open(sys.argv[3],"w").write(re.sub(r"/\*L\*/.*?/\*L\*/", "", re.sub(r"/\*D\*/.*?/\*D\*/", "import { carry } from \"./carried.js\";", t, flags=re.S), flags=re.S))' "$WIDE/wide.ts" "$W/$1.born/wide.ts" "$W/$1.doors/wide.ts"; }
  build() { build1 "$1" "$2" "$3" ""; build1 "$1" "$2" "$3" .born; build1 "$1" "$2" "$3" .doors; }
  build1() { local out="$1$2$4"; ( cd "$W/$1$4" && env ${3:+"BUN_JSC_$3"} BUN_AOT_TYPED_SNAPSHOT="$W/out/$out.snapshot" "$BUN" build --compile --aot --target=bun --define 'process.env.NODE_ENV="production"' wide.ts --outfile "$W/out/$out" < /dev/null > "$W/out/$out.build" 2>&1 )
    if grep -a -q TS100009 "$W/out/$out.build"; then echo "$out: A TYPED PACKAGE HAS FALLEN: $(grep -a -m1 TS100009 "$W/out/$out.build" | cut -c1-200)"; return; fi
    if [ -x "$W/out/$out" ]; then echo "$out: built: $(wc -c < "$W/out/$out" | tr -d ' ') B"; echo "$out" >> "$W/columns"; else echo "$out: NOT BUILT:"; grep -a -E -A2 'error|not compiled' "$W/out/$out.build" | head -30 | cut -c1-220; fi; }
  tree untyped; build untyped "" ""
  for pair in "$@"; do name="${pair%%=*}"; from="${pair#*=}"; tree "$name"; for d in "$name" "$name.born" "$name.doors"; do cp "$from/seroval.ts" "$W/$d/node_modules/seroval/dist/index.sound.ts"; printf '%s\n' 'export * from "./index.sound.ts";' > "$W/$d/node_modules/seroval/dist/index.js"; done
    if [ "${UNCHECKED:-0}" != 1 ]; then e="$( cd "$W/$name/node_modules/seroval/dist" && "${SEMA:?SEMA=<front end> or UNCHECKED=1}" cli index.sound.ts --noEmit --all --strict 2>&1 < /dev/null | sed -E 's/\x1b\[[0-9;]*m//g' | tail -1 )"; echo "   CHECK-LAID seroval/dist/index.sound.ts: $e" | cut -c1-160; case "$e" in *"No type errors"*) ;; *) echo "$name: NOT BUILT: TYPE ERRORS IN WHAT IS LAID"; continue;; esac; fi
    build "$name" "" ""; [ "${AUDIT:-0}" = 1 ] && build "$name" .audit auditAOTTypedAssertions=1; done
  exit 0; fi
cd "$W/untyped" || exit 1
if [ "$STEP" = answers ]; then for v in born doors; do ( cd "$W/untyped.$v" && "$BUN" wide.ts > "$W/out/plain.$v.txt" 2> /dev/null ); echo "plain, the $v program: exit $?: $(grep -c '^== ' "$W/out/plain.$v.txt") heads, $(grep -c THREW "$W/out/plain.$v.txt") THREW"; done; cmp -s "$W/out/plain.doors.txt" <( cd "$W/untyped" && "$BUN" wide.ts 2> /dev/null | grep -a -v 'fromJSON straight out of JSON.parse' ) && echo "plain: the doors program says what wide.ts says (less the one road of the L marks)" || echo "plain: THE DOORS PROGRAM SAYS SOMETHING ELSE THAN wide.ts"
  "$BUN" wide.ts > "$W/out/plain.txt" 2> "$W/out/plain.err"; echo "plain: exit $?: $(grep -c '^== ' "$W/out/plain.txt") heads, $(grep -c 'THREW' "$W/out/plain.txt") THREW (0 is due: else the scenario is at fault), $(wc -l < "$W/out/plain.txt" | tr -d ' ') lines, $(wc -l < "$W/out/plain.err" | tr -d ' ') lines on stderr"
  grep -B1 -A0 'THREW' "$W/out/plain.txt" | cut -c1-200 | head -20
  "$BUN" wide.ts > "$W/out/plain2.txt" 2> /dev/null; cmp -s "$W/out/plain.txt" "$W/out/plain2.txt" && echo "plain, a second time: the same text" || echo "plain, a second time: ANOTHER TEXT: THE TREE IS NOT DETERMINATE: $(cmp "$W/out/plain.txt" "$W/out/plain2.txt" 2>&1 | cut -c1-160)"
  while read -r c; do "$W/out/$c" > "$W/out/$c.txt" 2> "$W/out/$c.err"; code=$?
    ref="$W/out/plain.txt"; case "$c" in *.born) ref="$W/out/plain.born.txt";; *.doors) ref="$W/out/plain.doors.txt";; esac
    awk -v plain="$ref" -v c="$c" -v code="$code" '
      function flush() { if (head ~ /^== 9[89] /) { known = known "\n      " head ": " (text == of[head] ? "THE SAME AS PLAIN TODAY" : "differs, as known") "\n         here:  " substr(text, 1, 230) "         plain: " substr(of[head], 1, 230); head = "" } if (head != "") { n++; if (text != of[head]) { bad++; names = names "\n      " head; split(text, a, "\n"); split(of[head], b, "\n"); for (i = 1; i in a || i in b; i++) if (a[i] != b[i]) { names = names "\n         here:  " substr(a[i], 1, 190) "\n         plain: " substr(b[i], 1, 190); break } } } }
      BEGIN { while ((getline line < plain) > 0) { if (line ~ /^== /) h = line; else of[h] = of[h] line "\n" } }
      /^== / { flush(); head = $0; text = ""; next } { text = text $0 "\n" }
      END { flush(); print c ": exit " code ": " (bad + 0) " of " n " heads differ from the plain run" names known }' "$W/out/$c.txt"
    grep -a -E '^AOT: ' "$W/out/$c.err" | sort | uniq -c | sort -rn | head -40 | cut -c1-210
    grep -a -E '^\(TypeError: ' "$W/out/$c.err" | sort | uniq -c | sort -rn | head -12 | cut -c1-210
  done < "$W/columns"
  exit 0; fi
echo "wide1.sh build | answers"; exit 2
