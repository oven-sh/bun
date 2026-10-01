#!/usr/bin/env bash
set -euo pipefail
# Rebuilds corpus/ beside this script from two local clones, at the commits UPSTREAM pins or at the ones given.
export LC_ALL=C GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0

usage() {
  cat <<'EOF'
usage: sync.sh [--check | --verify[=<rev>]] <typescript-go clone> <TypeScript clone> [<typescript-go commit> [<TypeScript commit>]]

  (default)       make corpus/ equal to upstream, print what changed, update the commits in UPSTREAM
  --check         print what would change, write nothing, exit 1 if anything differs
  --verify[=rev]  compare the tree of a commit of this repository (default HEAD) with upstream, exit 1 if it differs

The clones are read through git plumbing only. Nothing is fetched and nothing is written into a clone.
EOF
}
die() { echo "sync.sh: $*" >&2; exit 2; }

mode=sync
rev=HEAD
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) mode=check ;;
    --verify) mode=verify ;;
    --verify=*) mode=verify; rev=${1#--verify=} ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; exit 2 ;;
    *) args+=("$1") ;;
  esac
  shift
done
if [ ${#args[@]} -lt 2 ] || [ ${#args[@]} -gt 4 ]; then usage >&2; exit 2; fi
go_clone=${args[0]}
ts_clone=${args[1]}
go_rev=${args[2]:-}
ts_rev=${args[3]:-}

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
upstream=$here/UPSTREAM
[ -f "$upstream" ] || die "missing $upstream"
tab=$(printf '\t')
max_path=206

field() { awk -v k="$1" -v r="$2" '$1 == k && $2 == r { print $3; exit }' "$upstream"; }
go_pin=$(field commit typescript-go)
ts_pin=$(field commit TypeScript)
go_root=$(field root typescript-go)
ts_root=$(field root TypeScript)
sub_path=$(field submodule typescript-go)
[ -n "$go_pin" ] && [ -n "$ts_pin" ] && [ -n "$go_root" ] && [ -n "$ts_root" ] && [ -n "$sub_path" ] || die "UPSTREAM lacks a commit, root or submodule record"
for r in "$go_root" "$ts_root"; do
  case "$r" in corpus/*[!A-Za-z0-9._-]* | corpus/ | corpus/.*) die "root $r must be one plain directory name below corpus/" ;; corpus/*) ;; *) die "root $r must be below corpus/" ;; esac
done
[ "$go_root" != "$ts_root" ] || die "both repositories have the root $go_root"

resolve() { git -C "$1" rev-parse --verify --quiet "$2^{commit}" || die "commit $2 is not in $1; fetch it yourself, this script uses no network"; }
git -C "$go_clone" rev-parse --git-dir > /dev/null 2>&1 || die "$go_clone is not a git repository"
git -C "$ts_clone" rev-parse --git-dir > /dev/null 2>&1 || die "$ts_clone is not a git repository"
go_commit=$(resolve "$go_clone" "${go_rev:-$go_pin}")
gitlink=$(git -C "$go_clone" ls-tree "$go_commit" -- "$sub_path" | awk '$1 == "160000" { print $3 }')
[ -n "$gitlink" ] || die "typescript-go $go_commit has no submodule at $sub_path"
ts_commit=$(resolve "$ts_clone" "${ts_rev:-$gitlink}")
[ "$ts_commit" = "$gitlink" ] || die "typescript-go $go_commit pins TypeScript $gitlink, not $ts_commit"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/conformance-sync.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# A scratch repository that borrows the objects of both clones, so that no object is written into a clone.
git init -q "$tmp/repo"
{
  git -C "$go_clone" rev-parse --path-format=absolute --git-path objects
  git -C "$ts_clone" rev-parse --path-format=absolute --git-path objects
} > "$tmp/repo/.git/objects/info/alternates"
echo '* -text -eol -ident -filter -working-tree-encoding' > "$tmp/repo/.git/info/attributes"
G() { git --git-dir="$tmp/repo/.git" --work-tree="$tmp/repo" -c core.quotePath=false -c core.autocrlf=false "$@"; }
commit_of() { if [ "$1" = TypeScript ]; then echo "$ts_commit"; else echo "$go_commit"; fi; }

: > "$tmp/ts.list"; : > "$tmp/go.list"; : > "$tmp/cases"; : > "$tmp/suites"; : > "$tmp/ts.errors"; : > "$tmp/go.errors"; : > "$tmp/derived"
list_of() { if [ "$1" = TypeScript ]; then echo "$tmp/ts.list"; else echo "$tmp/go.list"; fi; }

# Selects "<stem>.errors.txt" and "<stem>(<options>).errors.txt" for the stems of one suite, or of every suite when $3 is empty.
select_errors() {
  awk -F'\t' -v OFS='\t' -v suite="$3" -v unmatched="$4" '
    FILENAME == ARGV[1] { if (suite == "" || $1 == suite) stem[$2] = 1; next }
    $1 !~ /^100(644|755) blob / { next }
    {
      n = split($2, seg, "/"); b = seg[n]
      if (b !~ /\.errors\.txt$/) next
      core = substr(b, 1, length(b) - 11); hit = 0
      if (core in stem) hit = 1
      else if (substr(core, length(core)) == ")")
        for (i = 2; i < length(core); i++) if (substr(core, i, 1) == "(" && (substr(core, 1, i - 1) in stem)) hit++
      if (hit == 1) print $1, $2, b
      else print $2 >> unmatched
    }' "$1" "$2"
}

while read -r key repo kind path rest; do
  [ "$key" = copy ] || continue
  c=$(commit_of "$repo")
  case "$kind" in
    cases)
      G ls-tree -r "$c" -- "$path" > "$tmp/l"
      [ -s "$tmp/l" ] || die "$repo $c has nothing at $path"
      cat "$tmp/l" >> "$(list_of "$repo")"
      suite=${path##*/}
      echo "$suite" >> "$tmp/suites"
      awk -F'\t' -v OFS='\t' -v s="$suite" '$2 ~ /\.tsx?$/ { n = split($2, seg, "/"); b = seg[n]; sub(/\.tsx?$/, "", b); print s, b }' "$tmp/l" >> "$tmp/cases"
      ;;
    tree | file)
      G ls-tree -r "$c" -- "$path" > "$tmp/l"
      [ -s "$tmp/l" ] || die "$repo $c has nothing at $path"
      cat "$tmp/l" >> "$(list_of "$repo")"
      ;;
  esac
done < "$upstream"

dup=$(cut -f2 "$tmp/cases" | tr 'A-Z' 'a-z' | sort | uniq -d | head -5)
[ -z "$dup" ] || die "case names are not unique across suites: $dup"

while read -r key repo kind path rest; do
  [ "$key" = copy ] || continue
  c=$(commit_of "$repo")
  case "$kind" in
    errors)
      G ls-tree "$c" "$path/" > "$tmp/l"
      select_errors "$tmp/cases" "$tmp/l" "" "$tmp/ts.unmatched" >> "$tmp/ts.errors"
      ;;
  esac
done < "$upstream"
cut -f1,2 "$tmp/ts.errors" >> "$tmp/ts.list"

while read -r key repo kind path rest; do
  case "$key $kind" in
    "copy overlay")
      c=$(commit_of "$repo")
      while read -r suite; do
        G ls-tree "$c" "$path/$suite/" > "$tmp/l"
        select_errors "$tmp/cases" "$tmp/l" "$suite" "$tmp/go.unmatched" | awk -F'\t' -v OFS='\t' -v s="$suite" '{ print $1, $2, $3, s }' >> "$tmp/go.errors"
      done < "$tmp/suites"
      ;;
  esac
done < "$upstream"
awk -F'\t' -v OFS='\t' '
  FILENAME == ARGV[1] { split($1, m, " "); ts[$3] = m[3]; next }
  { split($1, m, " "); if (!($3 in ts) || ts[$3] != m[3]) print $1, $2 }' "$tmp/ts.errors" "$tmp/go.errors" > "$tmp/go.overlay"
cat "$tmp/go.overlay" >> "$tmp/go.list"

derived_path=
while read -r key repo kind path rest; do
  case "$key $kind" in
    "derive expects-no-errors")
      derived_path=$path
      c=$(commit_of "$repo")
      for dir in $rest; do
        while read -r suite; do
          G ls-tree "$c" "$dir/$suite/" | awk -F'\t' -v s="$suite" '$2 ~ /\.errors\.txt\.diff$/ { n = split($2, seg, "/"); b = seg[n]; print s "/" substr(b, 1, length(b) - 5) }'
        done < "$tmp/suites"
      done > "$tmp/diffs"
      awk -F'\t' '
        FILENAME == ARGV[1] { go[$4 "/" $3] = 1; next }
        FILENAME == ARGV[2] { ts[$3] = 1; next }
        { n = split($1, seg, "/"); if (!($1 in go) && (seg[2] in ts)) print $1 }' "$tmp/go.errors" "$tmp/ts.errors" "$tmp/diffs" | sort -u > "$tmp/derived"
      ;;
  esac
done < "$upstream"

for f in ts go; do
  sort -t"$tab" -k2 -u "$tmp/$f.list" > "$tmp/$f.target"
  if grep -q "$tab\"" "$tmp/$f.target"; then die "an upstream path needs quoting, which this script does not support"; fi
  if grep -v -E '^100(644|755) blob ' "$tmp/$f.target" | grep -q .; then die "an upstream entry is not a regular file"; fi
done
{ sed "s#^[^$tab]*$tab#$ts_root/#" "$tmp/ts.target"; sed "s#^[^$tab]*$tab#$go_root/#" "$tmp/go.target"; } > "$tmp/dest.paths"
fold=$(tr 'A-Z' 'a-z' < "$tmp/dest.paths" | sort | uniq -d | head -5)
[ -z "$fold" ] || die "paths collide on a case-insensitive file system: $fold"
repo_top=$(git -C "$here" rev-parse --show-toplevel)
rel=${here#"$repo_top"/}
longest=$(awk -v p="$rel/" '{ n = length(p $0); if (n > m) { m = n; s = p $0 } } END { print m "\t" s }' "$tmp/dest.paths")
[ "${longest%%"$tab"*}" -le "$max_path" ] || die "path longer than $max_path characters: ${longest#*"$tab"}"
runner_hit=$(awk -F/ '$NF ~ /\.[cm]?[jt]sx?$/ && ($NF ~ /\.test/ || $NF ~ /spec\./ || $NF ~ /_test\./)' "$tmp/dest.paths" | head -5)
[ -z "$runner_hit" ] || die "the test runner of this repository would take these files for tests: $runner_hit"

count() { awk 'END { print NR }' "$1"; }
echo "typescript-go $go_commit"
echo "TypeScript    $ts_commit"
echo "cases $(count "$tmp/cases"), TypeScript error baselines $(count "$tmp/ts.errors"), typescript-go error baselines $(count "$tmp/go.errors") of which copied $(count "$tmp/go.overlay"), expects-no-errors $(count "$tmp/derived")"
echo "$ts_root $(count "$tmp/ts.target") files, $go_root $(count "$tmp/go.target") files, longest path ${longest%%"$tab"*}"
for u in ts go; do
  if [ -s "$tmp/$u.unmatched" ]; then echo "not copied, no case has this name ($(count "$tmp/$u.unmatched")):"; sed 's/^/  /' "$tmp/$u.unmatched"; fi
done

compare() {
  awk -F'\t' -v OFS='\t' -v p="$3/" '
    FILENAME == ARGV[1] { t[$2] = $1; next }
    { c[$2] = $1 }
    END {
      for (k in t) if (!(k in c)) print "A", p k; else if (t[k] != c[k]) print "M", p k
      for (k in c) if (!(k in t)) print "D", p k
    }' "$1" "$2" | sort -t"$tab" -k2
}

if [ "$mode" = verify ]; then
  for pair in "ts:$ts_root" "go:$go_root"; do
    u=${pair%%:*}; root=${pair#*:}
    git -C "$repo_top" -c core.quotePath=false ls-tree -r "$rev" -- "$rel/$root/" | sed "s#$tab$rel/$root/#$tab#" | sort -t"$tab" -k2 > "$tmp/$u.ours"
    compare "$tmp/$u.target" "$tmp/$u.ours" "$root" >> "$tmp/changes"
  done
  ours=$(git -C "$repo_top" rev-parse --verify --quiet "$rev:$rel/$derived_path" || echo none)
  if [ "$ours" = none ]; then echo "A$tab$derived_path" >> "$tmp/changes"
  elif [ "$ours" != "$(git hash-object --stdin < "$tmp/derived")" ]; then echo "M$tab$derived_path" >> "$tmp/changes"; fi
  git -C "$repo_top" cat-file -e "$rev:$rel/UPSTREAM" 2> /dev/null || die "$rev has no $rel/UPSTREAM"
  pinned=$(git -C "$repo_top" show "$rev:$rel/UPSTREAM" | awk '$1 == "commit" { print $2, $3 }' | sort | tr '\n' ' ')
  [ "$pinned" = "TypeScript $ts_commit typescript-go $go_commit " ] || echo "M${tab}UPSTREAM" >> "$tmp/changes"
else
  for pair in "ts:$ts_root" "go:$go_root"; do
    u=${pair%%:*}; root=${pair#*:}
    : > "$tmp/$u.current"
    if [ -d "$here/$root" ]; then
      odd=$(cd "$here/$root" && find . ! -type f ! -type d | head -5)
      [ -z "$odd" ] || die "$root holds something that is neither a file nor a directory: $odd"
      (cd "$here/$root" && find . -type f | sed 's#^\./##' | sort) > "$tmp/$u.paths"
      sed "s#^#$here/$root/#" "$tmp/$u.paths" | git hash-object --no-filters --stdin-paths > "$tmp/$u.oids"
      if [ "$(git -C "$repo_top" config --get core.filemode || echo true)" = false ]; then
        awk -F'\t' 'FILENAME == ARGV[1] { split($1, m, " "); mode[$2] = m[1]; next } { print ($1 in mode ? mode[$1] : "100644") " blob" }' "$tmp/$u.target" "$tmp/$u.paths" > "$tmp/$u.modes"
      else
        while read -r p; do if [ -x "$here/$root/$p" ]; then echo "100755 blob"; else echo "100644 blob"; fi; done < "$tmp/$u.paths" > "$tmp/$u.modes"
      fi
      paste -d ' ' "$tmp/$u.modes" "$tmp/$u.oids" | paste - "$tmp/$u.paths" | sort -t"$tab" -k2 > "$tmp/$u.current"
    fi
    compare "$tmp/$u.target" "$tmp/$u.current" "$root" >> "$tmp/changes"
  done
  if [ ! -f "$here/$derived_path" ]; then echo "A$tab$derived_path" >> "$tmp/changes"
  elif ! cmp -s "$tmp/derived" "$here/$derived_path"; then echo "M$tab$derived_path" >> "$tmp/changes"; fi
fi

touch "$tmp/changes"
cat "$tmp/changes"
echo "added $(grep -c '^A' "$tmp/changes" || true), removed $(grep -c '^D' "$tmp/changes" || true), changed $(grep -c '^M' "$tmp/changes" || true)"

if [ "$mode" = verify ]; then
  if [ -s "$tmp/changes" ]; then exit 1; fi
  exit 0
fi

# X marks a file that is executable upstream, I a path that this repository ignores and that needs git add -f.
{
  awk -F'\t' -v p="$rel/$ts_root/" '$1 ~ /^100755 / { print "X\t" p $2 }' "$tmp/ts.target"
  awk -F'\t' -v p="$rel/$go_root/" '$1 ~ /^100755 / { print "X\t" p $2 }' "$tmp/go.target"
  sed "s#^#$rel/#" "$tmp/dest.paths" | git -C "$repo_top" check-ignore --no-index --stdin | sed "s#^#I$tab#" || true
} > "$tmp/notes"
cat "$tmp/notes"
echo "executable $(grep -c '^X' "$tmp/notes" || true), ignored $(grep -c '^I' "$tmp/notes" || true)"
if [ "$(git -C "$repo_top" check-attr text -- "$rel/$ts_root/LICENSE.txt" | awk '{ print $NF }')" != unset ]; then
  echo "sync.sh: warning: the attribute -text is not set below $rel/corpus, git add would rewrite line endings" >&2
fi

if [ "$mode" = check ]; then
  if [ -s "$tmp/changes" ]; then exit 1; fi
  exit 0
fi

if [ -s "$tmp/changes" ]; then
  rm -rf "${here:?}/$ts_root" "${here:?}/$go_root"
  mkdir -p "$here/$ts_root" "$here/$go_root"
  GIT_INDEX_FILE=$tmp/index.ts G update-index --index-info < "$tmp/ts.target"
  GIT_INDEX_FILE=$tmp/index.ts G checkout-index -a -f --prefix="$here/$ts_root/"
  GIT_INDEX_FILE=$tmp/index.go G update-index --index-info < "$tmp/go.target"
  GIT_INDEX_FILE=$tmp/index.go G checkout-index -a -f --prefix="$here/$go_root/"
  cp "$tmp/derived" "$here/$derived_path"
fi
if [ "$go_commit" != "$go_pin" ] || [ "$ts_commit" != "$ts_pin" ]; then
  awk -v g="$go_commit" -v t="$ts_commit" '$1 == "commit" && $2 == "typescript-go" { print $1, $2, g; next } $1 == "commit" && $2 == "TypeScript" { print $1, $2, t; next } { print }' "$upstream" > "$tmp/UPSTREAM"
  cat "$tmp/UPSTREAM" > "$upstream"
  echo "UPSTREAM now pins typescript-go $go_commit and TypeScript $ts_commit"
fi
