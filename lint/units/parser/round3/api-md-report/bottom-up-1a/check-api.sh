#!/bin/bash
# Parity check of the notes of the parser unit against the tree: what API.md says must be what the worktree holds.
# It reads files and asks git for objects. It starts no build, no cargo and no test: no lock is needed.
#   bash check-api.sh [<API.md>] [<worktree>] [<NEEDS.md>]
# Exit code 0 only when every check prints "ok". Each finding is one line that starts with "!!".
# Checks:
#   markers    no slot of a paste source is left: [[FILL ..]], [[CHECK ..]], [[PICK ..]], [[OR]], [[END]], <<..>>
#   stale      no sentence of round 1 or 2 that round 3 made false (the list STALE below, each with its reason)
#   commits    every `<hex of 9 to 12>` in backticks is a commit of the repository of the worktree
#   files      every path under src/, test/ or scripts/ that has no `*` exists in the worktree
#   lines      every `<file>.rs:<n>` names a line that the file has (files are found by name under src/js_parser, src/ast, src/jsc)
#   surface    api_surface.py of round 2: the public names of the interface files that API.md does not hold
#   tests      the number before "passed" in the row of `cargo test -p bun_js_parser --lib` is the number of #[test] in the crate
#   head       the commit that "State of this file" names is HEAD of the worktree, and the worktree has no uncommitted change under src/
set -u
API=${1:-/workspace/notes/lint/units/parser/API.md}
W=${2:-/workspace/wt/parser}
NEEDS=${3:-$(dirname "$API")/NEEDS.md}
SURFACE=/workspace/notes/lint/units/parser/round2/api-md-gates-report/bottom-up/api_surface.py
bad=0
say() { echo "!! $*"; bad=1; }
ok() { echo "ok $*"; }
[ -s "$API" ] || { echo "no file $API"; exit 2; }
[ -d "$W/src/js_parser" ] || { echo "no worktree $W"; exit 2; }

# markers
n=$(grep -c -E '\[\[(FILL|CHECK|PICK|OR\]\]|END\]\])|<<[^<>]+>>' "$API")
# `<<=>>` and the like are the marks of a token in the probe outputs of round 2: only a marker with a space or a word counts.
m=$(grep -n -E '\[\[(FILL|CHECK|PICK) |\[\[OR\]\]|\[\[END\]\]|<<[A-Za-z][^<>]*>>' "$API" | head -20)
if [ -n "$m" ]; then say "markers left ($n lines):"; echo "$m" | cut -c1-160 | sed 's/^/     /'; else ok "markers: none left"; fi

# stale: regex | why it is false after round 3
STALE='Nothing builds these nodes yet|the Build sink builds them since round 1
not built in the worktree|every file is built in the worktree: say what ran
Not built and not run in the worktree|the same
were not run\.|name the run, or say "not run at <commit>"
No test binary of the crate was built|the test binary builds: cargo test -p bun_js_parser --lib
No build has compared|type_sink_tests compares the Build sink with tsc
has no field for a code|Metadata::Code landed in 4d9b8e5139 (N1)
TypeSink::STRICT`, which is true|STRICT is gone: a site asks the side table
sink whose `STRICT` is true|STRICT is gone: the lint grammar has one sink
This holds for every sink|the skipper of main is not strict in any parse
CONDITIONAL_FALSE_LEVEL` is gone|it is back: a parse without lint is main
tested only on paths that[[:space:]]*$|is_lint_parse: list its readers at the final commit
`lexer_backtracker_kept` does not|state what the backtrackers of the final code truncate
tested through `x as T` only|type_sink_tests and grammar_rows_tests read the Build grammar too
EXPECTED_VERSION.{0,40}34|the version is 33 again
typescript-grammar[a-z*-]*\.test\.ts.{0,60}(pass|cases pass)|the four files are removed in R4: their cases are grammar_rows_tests.rs
One grammar reads every type|two grammars since round 3
A JavaScript file fills only `wrappers`|the decision on parentheses: see "What a lint parse of JavaScript records"'
found=0
while IFS='|' read -r re why; do
  [ -n "$re" ] || continue
  hit=$(grep -n -E -- "$re" "$API" | head -3)
  if [ -n "$hit" ]; then found=1; say "stale: /$re/ ($why)"; echo "$hit" | cut -c1-150 | sed 's/^/     /'; fi
done <<EOF
$STALE
EOF
[ $found = 0 ] && ok "stale: none of the known sentences"

# commits
missing=
for h in $(grep -o -E '`[0-9a-f]{9,12}`' "$API" | tr -d '`' | sort -u); do
  git -C "$W" cat-file -e "$h^{commit}" 2>/dev/null || missing="$missing $h"
done
[ -z "$missing" ] && ok "commits: every named commit is in the repository" || say "commits that the repository does not have:$missing"

# files
missing=
for f in $(grep -o -E '`?(src|test|scripts)/[A-Za-z0-9_./-]+\.(rs|ts|tsx|js|mjs|toml|yml)' "$API" | tr -d '`' | sort -u); do
  [ -e "$W/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] && ok "files: every named path exists" || say "paths that the worktree does not have:$(echo "$missing" | tr ' ' '\n' | sed 's/^/\n     /' | tr -d '\n')"

# lines
badlines=
for ref in $(grep -o -E '[A-Za-z0-9_/.-]+\.rs:[0-9]+' "$API" | sort -u); do
  f=${ref%%:*}; l=${ref##*:}
  if [ -e "$W/$f" ]; then p=$W/$f; else p=$(find "$W/src/js_parser" "$W/src/ast" "$W/src/jsc" -name "$(basename "$f")" -path "*$f" 2>/dev/null | head -1); fi
  [ -n "$p" ] && [ -e "$p" ] || { badlines="$badlines $ref(no-file)"; continue; }
  [ "$l" -le "$(wc -l < "$p")" ] || badlines="$badlines $ref(file-has-$(wc -l < "$p"))"
done
[ -z "$badlines" ] && ok "lines: every file:line is inside its file" || say "file:line beyond the file:$badlines"

# surface
if [ -s "$SURFACE" ]; then
  extra=$(cd "$W" && ls src/js_parser/parse/lint*.rs src/js_parser/parse/comment*.rs src/js_parser/parse/pragma*.rs 2>/dev/null | tr '\n' ' ')
  out=$(python3 "$SURFACE" "$W" "$API" $extra 2>&1)
  last=$(echo "$out" | tail -1)
  case "$last" in
    "0 public names"*) ok "surface: $last" ;;
    *) say "surface: $last"; echo "$out" | grep '!!' | head -12 | sed 's/^/     /' ;;
  esac
else
  say "surface: no $SURFACE"
fi

# tests
have=$(cd "$W" && grep -c '#\[test\]' src/js_parser/*.rs src/js_parser/parse/*.rs 2>/dev/null | awk -F: '{ s += $2 } END { print s }')
said=$(grep -E 'cargo test -p bun_js_parser --lib`? *\|' "$API" | grep -o -E '[0-9]+ passed' | head -1 | cut -d' ' -f1)
if [ -z "$said" ]; then say "tests: no row '| \`cargo test -p bun_js_parser --lib\` | <n> passed' in $API (the crate has $have #[test])"
elif [ "$said" = "$have" ]; then ok "tests: $said passed, and the crate has $have #[test]"
else say "tests: API.md says $said passed, the crate has $have #[test]"; fi

# head
head=$(git -C "$W" rev-parse --short=10 HEAD)
named=$(awk '/^## State of this file/ { on = 1 } on && match($0, /`[0-9a-f]{10}`/) { print substr($0, RSTART + 1, 10); exit }' "$API")
dirty=$(git -C "$W" status --porcelain --untracked-files=no -- src | wc -l)
if [ -z "$named" ]; then say "head: no section 'State of this file' that names a commit (HEAD is $head)"
elif [ "$named" != "$head" ]; then say "head: 'State of this file' names $named, HEAD is $head: $(git -C "$W" log --oneline "$named..HEAD" -- src/js_parser src/ast 2>/dev/null | wc -l) commits under src/js_parser and src/ast came after it"
else ok "head: $named is HEAD"; fi
[ "$dirty" = 0 ] || say "head: $dirty files under src/ are changed and not committed: API.md describes a commit"

# NEEDS.md
if [ -s "$NEEDS" ]; then
  grep -q -E '^## N1\..*(landed|Landed)|Landed in `4d9b8e5139`' "$NEEDS" && ok "needs: N1 is marked as landed" || say "needs: N1 of $NEEDS does not say that it landed (4d9b8e5139)"
  grep -q 'has no field for a code' "$NEEDS" && say "needs: N1 still says that Msg has no field for a code"
fi
[ $bad = 0 ] && echo "RESULT ok" || echo "RESULT findings"
exit $bad
