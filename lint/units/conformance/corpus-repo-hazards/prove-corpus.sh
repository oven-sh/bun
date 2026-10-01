#!/usr/bin/env bash
# usage: prove-corpus.sh [repository] [commit]; proves that the corpus of that commit equals the upstream trees.
set -euo pipefail

REPO=${1:-.}
REV=${2:-HEAD}
C=${CORPUS:-test/cli/lint/conformance/corpus}
TS=${TS_CLONE:-/workspace/ref/typescript-go/_submodules/TypeScript}
TSC=${TS_COMMIT:-5848bc5157b22ff7f4e3369f4645a514a433b15f}
GO=${TSGO_CLONE:-/workspace/ref/typescript-go}
GOC=${TSGO_COMMIT:-89d5d5b2849a0db0957065889ca58536fa6d2e4a}
# Layout of the corpus, relative to $C.
CASES=${CASES_DIR:-cases}
BASE_TSC=${TSC_DIR:-baselines/tsc}
BASE_TSGO=${TSGO_DIR:-baselines/tsgo}
LISTS=${LISTS_DIR:-tsgo}
# Files of this repository that live at the top of the corpus and are not vendored.
OWN=${OWN_FILES:-'\.gitattributes|\.gitignore|\.editorconfig|UPSTREAM|MANIFEST|LICENSE[^/]*'}
# 1 = every typescript-go baseline, 0 = only those that differ from TypeScript's or that TypeScript lacks.
ALL_TSGO=${ALL_TSGO:-0}

cd "$REPO"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
tab=$(printf '\t')
fail=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=1; }

git -C "$TS" cat-file -e "$TSC^{commit}"
git -C "$GO" cat-file -e "$GOC^{commit}"
link=$(git -C "$GO" ls-tree "$GOC" -- _submodules/TypeScript | awk '{print $3}')
[ "$link" = "$TSC" ] && ok "typescript-go $GOC pins TypeScript $TSC" || bad "typescript-go pins TypeScript $link, not $TSC"

# Expected: "<mode> <blob>\t<path below the corpus>".
git -C "$TS" ls-tree -r "$TSC" -- tests/cases/conformance tests/cases/compiler |
  sed -E "s#^([0-9]+) blob ([0-9a-f]+)${tab}tests/cases/#\1 \2${tab}$CASES/#" > "$T/cases"
git -C "$TS" ls-tree "$TSC" -- tests/baselines/reference/ | grep -E "^[0-9]+ blob [0-9a-f]+${tab}.*\.errors\.txt\$" |
  sed -E "s#^([0-9]+) blob ([0-9a-f]+)${tab}tests/baselines/reference/#\1 \2${tab}#" > "$T/tsc"
git -C "$GO" ls-tree -r "$GOC" -- testdata/baselines/reference/submodule/compiler testdata/baselines/reference/submodule/conformance |
  grep -E '\.errors\.txt$' |
  sed -E "s#^([0-9]+) blob ([0-9a-f]+)${tab}testdata/baselines/reference/submodule/#\1 \2${tab}#" > "$T/tsgo.all"
if [ "$ALL_TSGO" = 1 ]; then cp "$T/tsgo.all" "$T/tsgo"; else
  awk -F'\t' 'NR==FNR { split($1, a, " "); ts[$2] = a[2]; next }
              { split($1, a, " "); n = $2; sub(/^.*\//, "", n); if (!(n in ts) || ts[n] != a[2]) print }' "$T/tsc" "$T/tsgo.all" > "$T/tsgo"
fi
git -C "$GO" ls-tree "$GOC" -- testdata/submoduleAccepted.txt testdata/submoduleTriaged.txt |
  sed -E "s#^([0-9]+) blob ([0-9a-f]+)${tab}testdata/#\1 \2${tab}$LISTS/#" > "$T/lists"
{
  cat "$T/cases"
  sed -E "s#${tab}#${tab}$BASE_TSC/#" "$T/tsc"
  sed -E "s#${tab}#${tab}$BASE_TSGO/#" "$T/tsgo"
  cat "$T/lists"
} | LC_ALL=C sort -t"$tab" -k2 > "$T/expected"

git ls-tree -r "$REV" -- "$C" > "$T/tree"
if grep -q "${tab}\"" "$T/tree"; then bad "a path needs quoting: this script does not handle it"; fi
if awk '$2 != "blob" || ($1 != "100644" && $1 != "100755")' "$T/tree" | grep -q .; then bad "the corpus holds a symlink or a submodule"; fi
sed -E "s#^([0-9]+) blob ([0-9a-f]+)${tab}$C/#\1 \2${tab}#" "$T/tree" | grep -v -E "${tab}($OWN)\$" |
  LC_ALL=C sort -t"$tab" -k2 > "$T/actual"

n=$(wc -l < "$T/expected" | tr -d ' ')
if cmp -s "$T/expected" "$T/actual"; then ok "$n vendored files: every path, mode and blob id equals upstream"; else
  bad "the commit differs from upstream"
  printf '      missing %s, unexpected %s, different content or mode %s\n' \
    "$(LC_ALL=C comm -23 <(cut -f2 "$T/expected") <(cut -f2 "$T/actual") | wc -l | tr -d ' ')" \
    "$(LC_ALL=C comm -13 <(cut -f2 "$T/expected") <(cut -f2 "$T/actual") | wc -l | tr -d ' ')" \
    "$(LC_ALL=C join -t"$tab" -1 2 -2 2 <(LC_ALL=C sort -t"$tab" -k2 "$T/expected") <(LC_ALL=C sort -t"$tab" -k2 "$T/actual") | awk -F'\t' '$2 != $3' | wc -l | tr -d ' ')"
  { diff "$T/expected" "$T/actual" || true; } | awk 'NR <= 10' | sed 's/^/      /'
fi

for d in conformance compiler; do
  a=$(git rev-parse "$REV:$C/$CASES/$d" 2>/dev/null || echo none)
  b=$(git -C "$TS" rev-parse "$TSC:tests/cases/$d")
  [ "$a" = "$b" ] && ok "tree of $CASES/$d is upstream's tree $b" || bad "tree of $CASES/$d is $a, upstream's is $b"
done

x=$(git ls-tree -r --name-only "$REV" -- "$C" | git check-attr --source="$REV" --stdin text | grep -v -c ': text: unset$' || true)
[ "$x" = 0 ] && ok "text attribute is unset for every path (attributes read from the commit)" || bad "$x paths are open to end-of-line conversion"

x=$(git ls-tree -r --name-only "$REV" -- "$C" | git check-ignore --no-index --stdin | wc -l | tr -d ' ' || true)
[ "$x" = 0 ] && ok "no path matches an ignore rule" || bad "$x paths match an ignore rule: the next 'git add <directory>' drops them"

x=$(git ls-tree -r -t --name-only "$REV" -- "$C" | tr 'A-Z' 'a-z' | LC_ALL=C sort | uniq -d | wc -l | tr -d ' ')
[ "$x" = 0 ] && ok "no two paths differ only by case" || bad "$x paths collide on a case-insensitive file system"

x=$(git ls-tree -r -t --name-only "$REV" -- "$C" | grep -c -i -E '[<>:"|?*\\]|(^|/)(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.[^/]*)?(/|$)|[ .](/|$)' || true)
[ "$x" = 0 ] && ok "no name that Windows refuses" || bad "$x names that Windows refuses"

x=$(git ls-tree -r --name-only "$REV" -- "$C" | awk -F/ '{print $NF}' | grep -E '\.(c|m)?(j|t)sx?$' | grep -c -i -E '\.test|spec\.|[._](test|spec)\.[cm]?[jt]sx?$' || true)
[ "$x" = 0 ] && ok "no name that test discovery picks up" || bad "$x names that test discovery picks up"

x=$(git ls-tree -r --name-only "$REV" -- "$C" | awk -F/ '$NF ~ /^\./ || $NF ~ /^(package\.json|tsconfig.*\.json|jsconfig\.json|bunfig\.toml)$/' | grep -v -c -E "^$C/($OWN)\$" || true)
[ "$x" = 0 ] && ok "no vendored dotfile or tool configuration" || bad "$x vendored dotfiles or tool configurations"

m=$(git ls-tree -r --name-only "$REV" -- "$C" | awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }')
[ "$m" -le "${MAX_PATH_LEN:-200}" ] && ok "longest path is $m characters" || bad "longest path is $m characters"

mkdir "$T/x"
git -c core.autocrlf=true -c core.eol=crlf archive "$REV" -- "$C" | tar -x -C "$T/x"
LC_ALL=C join -t"$tab" -1 2 -2 2 "$T/expected" "$T/actual" | cut -f1,2 > "$T/both"
( cd "$T/x/$C" && cut -f1 "$T/both" | git hash-object --no-filters --stdin-paths ) > "$T/x.ids"
x=$(paste -d' ' <(cut -f2 "$T/both" | cut -d' ' -f2) "$T/x.ids" | awk '$1 != $2' | wc -l | tr -d ' ')
[ "$x" = 0 ] && ok "a checkout with core.autocrlf=true and core.eol=crlf writes upstream's bytes ($(wc -l < "$T/both" | tr -d ' ') files)" || bad "$x files differ from upstream after a checkout with core.autocrlf=true"

if [ "$REV" = HEAD ] && [ "$(git rev-parse --is-inside-work-tree)" = true ]; then
  x=$(git status --porcelain --ignored=matching -- "$C" | wc -l | tr -d ' ')
  [ "$x" = 0 ] && ok "worktree: nothing modified, untracked or ignored below the corpus" || bad "worktree: $x paths modified, untracked or ignored"
  x=$(git -c core.autocrlf=true -c core.ignorecase=true -c core.precomposeUnicode=true status --porcelain -- "$C" | wc -l | tr -d ' ')
  [ "$x" = 0 ] && ok "worktree: clean with the settings of the autofix workflow" || bad "worktree: $x paths modified with the settings of the autofix workflow"
  x=$(git ls-files --eol -- "$C" | awk '{ if ($3 != "attr/-text" || substr($1, 3) != substr($2, 3)) n++ } END { print n + 0 }')
  [ "$x" = 0 ] && ok "git ls-files --eol: index and worktree agree, attr/-text everywhere" || bad "git ls-files --eol: $x lines disagree"
  git ls-files --eol -- "$C" | awk '{ print $1 }' | sort | uniq -c | sed 's/^/      /'
fi
echo "      files in the commit below the corpus: $(wc -l < "$T/tree" | tr -d ' ')"
exit $fail
