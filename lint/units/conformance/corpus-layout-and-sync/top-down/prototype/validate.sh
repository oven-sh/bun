#!/usr/bin/env bash
set -euo pipefail
# Research probe: runs the sync prototype in scratch repositories that carry this repository's root .gitattributes and .gitignore.
export LC_ALL=C
if [ $# -lt 3 ]; then echo "usage: validate.sh <bun worktree> <typescript-go clone> <TypeScript clone> [<scratch directory>]" >&2; exit 2; fi
bun_tree=$1
go_clone=$2
ts_clone=$3
scratch=${4:-$(mktemp -d "${TMPDIR:-/tmp}/conformance-validate.XXXXXX")}
proto=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
home=test/cli/lint/conformance
tab=$(printf '\t')

fresh() {
  rm -rf "$1"
  mkdir -p "$1/$home"
  cd "$1"
  git init -q -b main .
  git config user.email probe@example.invalid
  git config user.name probe
  cp "$bun_tree/.gitattributes" "$bun_tree/.gitignore" .
  git add .gitattributes .gitignore
  git -c gc.auto=0 commit -q -m base
  cp "$proto/UPSTREAM" "$proto/sync.sh" "$home/"
  chmod +x "$home/sync.sh"
}

echo "== 1. without the nested attributes file: git add rewrites line endings and skips the ignored file"
fresh "$scratch/without"
"$home/sync.sh" "$go_clone" "$ts_clone" 2>&1 | grep -v "^[AMD]$tab" || true
git -c gc.auto=0 add -- "$home" 2> /dev/null
git -c gc.auto=0 -c maintenance.auto=false commit -q -m "without attributes"
"$home/sync.sh" --verify "$go_clone" "$ts_clone" | tail -n 1 || true

echo "== 2. with the nested attributes file"
fresh "$scratch/with"
cp "$proto/gitattributes" "$home/.gitattributes"
"$home/sync.sh" "$go_clone" "$ts_clone" > "$scratch/sync.out"
grep -v "^[AMD]$tab" "$scratch/sync.out"
git -c gc.auto=0 add -- "$home/.gitattributes" "$home/UPSTREAM" "$home/sync.sh"
git check-attr text -- "$home/corpus/ts/LICENSE.txt"
git -c gc.auto=0 -c core.bigFileThreshold=1 add -- "$home/corpus"
grep "^I$tab" "$scratch/sync.out" | cut -f2 | while read -r p; do git -c gc.auto=0 -c core.bigFileThreshold=1 add -f -- "$p"; done
git -c gc.auto=0 -c maintenance.auto=false commit -q -m corpus
echo "objects: $(git count-objects -v | tr '\n' ' ')"
echo "untracked or ignored leftovers: $(git status --porcelain --ignored | awk 'END { print NR }')"
"$home/sync.sh" --verify "$go_clone" "$ts_clone" | tail -n 1
"$home/sync.sh" "$go_clone" "$ts_clone" | grep -E '^added'
echo "changes after the second run: $(git status --porcelain | awk 'END { print NR }')"

echo "== 3. every entry of the commit exists upstream with the same mode, id and path"
git -c core.quotePath=false ls-tree -r HEAD -- "$home/corpus/ts/" | sed "s#$tab$home/corpus/ts/#$tab#" | sort > "$scratch/ours.ts"
git -C "$ts_clone" -c core.quotePath=false ls-tree -r "$(awk '$1 == "commit" && $2 == "TypeScript" { print $3 }' "$home/UPSTREAM")" | sort > "$scratch/theirs.ts"
git -c core.quotePath=false ls-tree -r HEAD -- "$home/corpus/tsgo/" | sed "s#$tab$home/corpus/tsgo/#$tab#" | sort > "$scratch/ours.go"
git -C "$go_clone" -c core.quotePath=false ls-tree -r "$(awk '$1 == "commit" && $2 == "typescript-go" { print $3 }' "$home/UPSTREAM")" | sort > "$scratch/theirs.go"
echo "corpus/ts entries $(awk 'END { print NR }' "$scratch/ours.ts"), not upstream $(comm -23 "$scratch/ours.ts" "$scratch/theirs.ts" | awk 'END { print NR }')"
echo "corpus/tsgo entries $(awk 'END { print NR }' "$scratch/ours.go"), not upstream $(comm -23 "$scratch/ours.go" "$scratch/theirs.go" | awk 'END { print NR }')"

echo "== 4. size"
git ls-tree -r -l HEAD -- "$home/corpus" | awk '{ n++; s += $4 } END { print n " files, " s " bytes" }'
git bundle create -q "$scratch/corpus.bundle" HEAD~1..HEAD
echo "bundle of the commit: $(wc -c < "$scratch/corpus.bundle") bytes"
git clone -q --bare --no-local --single-branch --branch main "file://$scratch/with" "$scratch/clone.git"
echo "fresh clone: $(git -C "$scratch/clone.git" count-objects -vH | tr '\n' ' ')"
echo "scratch left at $scratch"
