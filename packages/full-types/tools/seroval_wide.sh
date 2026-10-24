#!/bin/bash
# seroval_wide.sh build | answers <bun> <work folder> [<name>=<folder with seroval.ts> ..]
#
# Checks that full types of seroval 1.6.9 behaves like the package from npm. The test program is
# trees/seroval/wide.ts: scenarios that cover the public API, each printed under a `== name` header.
# <bun> is a build of Bun that has --aot.
#
#   build    Compiles the program against the untouched package (`untyped`) and against each full types (`<name>`).
#            Runs no package code.
#   answers  Runs the same source with `bun run`, twice (the output must be deterministic), then runs every executable
#            and compares the output section by section. Prints the `[aot] type-error` lines of each run by kind.
#            Runs package code, so run it in a sandbox.
#
# Environment:
#   NODE_MODULES  A node_modules folder with seroval 1.6.9 and @types/node. seroval, @types/node and undici-types are
#                 copied from it into each project. The md5 of seroval/dist/index.js must start with ccbd0950: that is
#                 the file the full types were written for.
#   SEMA          The type checker's command-line tool. Full types with a type error under --strict is not built.
#                 UNCHECKED=1 skips the check.
#   AUDIT=1       Also builds each full types with --aot-type-errors=log, as `<name>.audit`.
#   WIDE          The folder with wide.ts. Default: trees/seroval.
#
# The full-types file is installed as seroval/dist/index.sound.ts, and seroval/dist/index.js becomes
# `export * from "./index.sound.ts";`. It is not named index.ts: next to index.js the checker prefers index.ts to the
# package's own index.d.ts, so the full-types file would hide the package's public types (`deserialize<T>()` ..) and a
# user's program would get type errors (TS2558). This way importers see the package's declaration file and run the
# full-types file.
#
# The compiler analyzes the entire program, so one call that passes parsed JSON to seroval can open the layout of
# SerovalNode everywhere. wide.ts is therefore built as three programs, each in a folder of its own, and each is
# compared with its own source under `bun run`:
#   <name>           wide.ts as it is: fromJSON gets the result of JSON.parse directly.
#   <name>.internal  The text between /*C*/ marks is removed: seroval only sees nodes that it allocated, as in a server.
#   <name>.boundary  The text between /*D*/ marks becomes `import { carry } from "./carried.js";` and the text between
#                    /*L*/ marks is removed: parsed JSON reaches compileJSON, fromJSON and fromCrossJSON only through
#                    an untyped file that is declared as `carry<T>(x: T): T`, as when an untyped package calls seroval.
#
# A build whose log has TS100009 (the typed package was compiled without its types) fails. A section whose header
# starts with `== 98 ` or `== 99 ` is known to differ: it is printed and not counted.
set -u
export NO_COLOR=1 BUN_ENABLE_CRASH_REPORTING=0 NODE_ENV=production TZ=America/Los_Angeles

usage() {
  echo "usage: seroval_wide.sh build | answers <bun> <work folder> [<name>=<folder with seroval.ts> ..]"
  exit 2
}
[ $# -ge 3 ] || usage
STEP="$1"; BUN="$2"; WORK="$3"; shift 3
HERE="$(cd "$(dirname "$0")" && pwd)"
WIDE="${WIDE:-$HERE/../trees/seroval}"
MODULES="${NODE_MODULES:?NODE_MODULES=<a node_modules folder with seroval 1.6.9 and @types/node>}"
if [ "$(uname)" = Darwin ]; then md5_of() { md5 -q "$1"; }; else md5_of() { md5sum "$1" | cut -c1-32; }; fi

if [ "$STEP" = build ]; then
  mkdir -p "$WORK/out"; : > "$WORK/builds"
  sum="$(md5_of "$MODULES/seroval/dist/index.js" | cut -c1-8)"
  if [ "$sum" != ccbd0950 ]; then
    echo "seroval_wide.sh: the md5 of seroval/dist/index.js starts with $sum: the full types were written for ccbd0950"
    exit 1
  fi

  create_project() {
    mkdir -p "$WORK/$1/node_modules/@types"
    cp "$WIDE/tsconfig.json" "$WORK/$1/"
    cp -R "$MODULES/seroval" "$WORK/$1/node_modules/seroval"
    cp -R "$MODULES/@types/node" "$WORK/$1/node_modules/@types/node"
    [ -d "$MODULES/undici-types" ] && cp -R "$MODULES/undici-types" "$WORK/$1/node_modules/undici-types"
  }

  create_projects() {
    create_project "$1"; create_project "$1.internal"; create_project "$1.boundary"
    cp "$WIDE/wide.ts" "$WORK/$1/"
    cp "$WIDE/carried.js" "$WIDE/carried.d.ts" "$WORK/$1.boundary/"
    python3 -c '
import re, sys
replace = lambda mark, replacement, text: re.sub(r"/\*%s\*/.*?/\*%s\*/" % (mark, mark), replacement, text, flags=re.S)
text = open(sys.argv[1]).read()
open(sys.argv[2], "w").write(replace("C", "", text))
open(sys.argv[3], "w").write(replace("L", "", replace("D", "import { carry } from \"./carried.js\";", text)))
' "$WIDE/wide.ts" "$WORK/$1.internal/wide.ts" "$WORK/$1.boundary/wide.ts"
  }

  # compile <name> <suffix of the executable> <option> <variant>
  compile() {
    local out="$1$2$4"
    ( cd "$WORK/$1$4" && "$BUN" build --compile --aot ${3:+"$3"} --target=bun --define 'process.env.NODE_ENV="production"' wide.ts --outfile "$WORK/out/$out" < /dev/null > "$WORK/out/$out.build" 2>&1 )
    if grep -a -q TS100009 "$WORK/out/$out.build"; then
      echo "$out: FAILED: the typed package was compiled without its types: $(grep -a -m1 TS100009 "$WORK/out/$out.build" | cut -c1-200)"
      return
    fi
    if [ -x "$WORK/out/$out" ]; then
      echo "$out: built: $(wc -c < "$WORK/out/$out" | tr -d ' ') B"
      echo "$out" >> "$WORK/builds"
    else
      echo "$out: NOT BUILT:"
      grep -a -E -A2 'error|not compiled' "$WORK/out/$out.build" | head -30 | cut -c1-220
    fi
  }

  compile_variants() {
    compile "$1" "$2" "$3" ""; compile "$1" "$2" "$3" .internal; compile "$1" "$2" "$3" .boundary
  }

  create_projects untyped; compile_variants untyped "" ""
  for pair in "$@"; do
    name="${pair%%=*}"; from="${pair#*=}"
    create_projects "$name"
    for project in "$name" "$name.internal" "$name.boundary"; do
      cp "$from/seroval.ts" "$WORK/$project/node_modules/seroval/dist/index.sound.ts"
      printf '%s\n' 'export * from "./index.sound.ts";' > "$WORK/$project/node_modules/seroval/dist/index.js"
    done
    if [ "${UNCHECKED:-0}" != 1 ]; then
      result="$( cd "$WORK/$name/node_modules/seroval/dist" && "${SEMA:?SEMA=<the type checker> or UNCHECKED=1}" cli index.sound.ts --noEmit --all --strict 2>&1 < /dev/null | sed -E 's/\x1b\[[0-9;]*m//g' | tail -1 )"
      echo "   type check of seroval/dist/index.sound.ts: $result" | cut -c1-160
      case "$result" in
        *"No type errors"*) ;;
        *) echo "$name: NOT BUILT: the full-types file has type errors"; continue;;
      esac
    fi
    compile_variants "$name" "" ""
    [ "${AUDIT:-0}" = 1 ] && compile_variants "$name" .audit --aot-type-errors=log
  done
  exit 0
fi

if [ "$STEP" = answers ]; then
  cd "$WORK/untyped" || exit 1
  for variant in internal boundary; do
    ( cd "$WORK/untyped.$variant" && "$BUN" wide.ts > "$WORK/out/reference.$variant.txt" 2> /dev/null )
    echo "bun run, the $variant program: exit $?: $(grep -c '^== ' "$WORK/out/reference.$variant.txt") sections, $(grep -c THREW "$WORK/out/reference.$variant.txt") THREW"
  done
  if cmp -s "$WORK/out/reference.boundary.txt" <( "$BUN" wide.ts 2> /dev/null | grep -a -v 'fromJSON straight out of JSON.parse' ); then
    echo "bun run: the boundary program prints what wide.ts prints (without the line between the L marks)"
  else
    echo "bun run: FAILED: the boundary program and wide.ts print different text"
  fi

  "$BUN" wide.ts > "$WORK/out/reference.txt" 2> "$WORK/out/reference.err"
  echo "bun run: exit $?: $(grep -c '^== ' "$WORK/out/reference.txt") sections, $(grep -c 'THREW' "$WORK/out/reference.txt") THREW (expected 0: a scenario that throws here is broken), $(wc -l < "$WORK/out/reference.txt" | tr -d ' ') lines, $(wc -l < "$WORK/out/reference.err" | tr -d ' ') lines on stderr"
  grep -B1 -A0 'THREW' "$WORK/out/reference.txt" | cut -c1-200 | head -20
  "$BUN" wide.ts > "$WORK/out/reference.again.txt" 2> /dev/null
  if cmp -s "$WORK/out/reference.txt" "$WORK/out/reference.again.txt"; then
    echo "bun run, a second time: the same output"
  else
    echo "bun run, a second time: FAILED: the program is not deterministic: $(cmp "$WORK/out/reference.txt" "$WORK/out/reference.again.txt" 2>&1 | cut -c1-160)"
  fi

  while read -r build; do
    "$WORK/out/$build" < /dev/null > "$WORK/out/$build.txt" 2> "$WORK/out/$build.err"; code=$?
    reference="$WORK/out/reference.txt"
    case "$build" in
      *.internal) reference="$WORK/out/reference.internal.txt";;
      *.boundary) reference="$WORK/out/reference.boundary.txt";;
    esac
    awk -v reference="$reference" -v build="$build" -v code="$code" '
      function finish_section() {
        if (header ~ /^== 9[89] /) {
          known = known "\n      " header ": " (text == expected[header] ? "the same as bun run today" : "differs, as expected") "\n         compiled: " substr(text, 1, 230) "         bun run:  " substr(expected[header], 1, 230)
          header = ""
        }
        if (header == "") return
        total++
        if (text == expected[header]) return
        different++
        details = details "\n      " header
        split(text, a, "\n"); split(expected[header], b, "\n")
        for (i = 1; i in a || i in b; i++) if (a[i] != b[i]) {
          details = details "\n         compiled: " substr(a[i], 1, 190) "\n         bun run:  " substr(b[i], 1, 190)
          break
        }
      }
      BEGIN { while ((getline line < reference) > 0) { if (line ~ /^== /) h = line; else expected[h] = expected[h] line "\n" } }
      /^== / { finish_section(); header = $0; text = ""; next }
      { text = text $0 "\n" }
      END { finish_section(); print build ": exit " code ": " (different + 0) " of " (total + 0) " sections differ from bun run" details known }' "$WORK/out/$build.txt"
    grep -a -E '^\[aot\] type-error ' "$WORK/out/$build.err" | sed -E 's/; count [0-9]+.*$//' | sort | uniq -c | sort -rn | head -40 | cut -c1-210
    grep -a -E '^\(TypeError: ' "$WORK/out/$build.err" | sort | uniq -c | sort -rn | head -12 | cut -c1-210
  done < "$WORK/builds"
  exit 0
fi

usage
