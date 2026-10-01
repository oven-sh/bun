#!/usr/bin/env bash
# usage: readers.sh <directory> [step ...]
# Measures what the tools of the repository do with the corpus once it is committed. Nothing in the unit's worktree changes:
# the first step makes a full clone that shares the objects of /workspace/bun, writes the corpus into it with sync.sh and
# commits it there. Steps (default: all but tsc-full): clone prove git prettier oxlint tsc-list tsc-full
# tsc-full type-checks the test project twice and belongs behind the lock: /workspace/tools/lk bash readers.sh <directory> tsc-full
set -euo pipefail
dir=${1:?usage: readers.sh <directory> [step ...]}
shift
steps=${*:-clone prove git prettier oxlint tsc-list}
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
notes=$(cd -- "$here/../../.." && pwd)
wt=/workspace/wt/conformance
H=test/cli/lint/conformance
go=/workspace/ref/typescript-go
ts=$go/_submodules/TypeScript
has() { case " $steps " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

if has clone; then
  git clone -q --shared --no-checkout /workspace/bun "$dir"
  git -C "$dir" checkout -q --detach "$(git -C "$wt" rev-parse HEAD)"
  cd "$dir"
  git config user.email scratch@example.invalid
  git config user.name scratch
  [ -f $H/UPSTREAM ] || cp "$notes/corpus-layout-and-sync/top-down/prototype/UPSTREAM" $H/UPSTREAM
  bash $H/sync.sh "$go" "$ts" | tail -4
  git add $H
  git add -f $H/corpus
  git commit -q -m "scratch: the synced corpus"
  ln -s "$wt/node_modules" node_modules
  ln -s "$wt/test/node_modules" test/node_modules
  echo "clone at $dir, commit $(git rev-parse --short=10 HEAD), $(git ls-tree -r --name-only HEAD -- $H | wc -l) paths below $H"
fi
cd "$dir"

if has prove; then bun "$here/prove-no-corpus-test.ts" --bun "$(command -v bun)" || true; fi

if has git; then
  set_by_autofix="-c core.autocrlf=true -c core.ignorecase=true -c core.precomposeUnicode=true"
  echo "git: paths an ignore rule matches: $(git ls-tree -r --name-only HEAD -- $H | git check-ignore --no-index --stdin | wc -l)"
  echo "git: paths whose text attribute is not unset, outside runner/ and fixtures/:"
  git ls-tree -r --name-only HEAD -- $H | git check-attr --stdin text | grep -v ': text: unset$' | grep -v '/runner/\|/fixtures/' | sed 's/^/  /'
  echo "git: status with the settings of format.yml: $(git $set_by_autofix status --porcelain -- $H | wc -l) paths"
  git $set_by_autofix add -A -- $H
  echo "git: staged by add -A with those settings: $(git diff --cached --name-only | wc -l)"
  git reset -q
  git -c core.autocrlf=true add --renormalize -- $H
  echo "git: staged by add --renormalize with core.autocrlf=true: $(git diff --cached --name-only | tr '\n' ' ')"
  git reset -q
  echo "git: *.d.ts below $H (CODEOWNERS line 8): $(git ls-tree -r --name-only HEAD -- $H | grep -c '\.d\.ts$')"
  echo "git: case collisions $(git ls-tree -r -t --name-only HEAD -- $H | tr 'A-Z' 'a-z' | LC_ALL=C sort | uniq -d | wc -l), longest path $(git ls-tree -r --name-only HEAD -- $H | awk '{ if (length($0) > m) m = length($0) } END { print m }')"
fi

if has prettier; then
  bun run prettier > prettier.log 2>&1 || true
  echo "prettier: files taken $(grep -c 'ms' prettier.log), below test/cli/lint: $(grep 'test/cli/lint' prettier.log | tr '\n' ' ')"
  echo "prettier: lines that name conformance/: $(grep -c 'conformance/' prettier.log), paths changed in the clone: $(git status --porcelain | grep -vc '^??')"
fi

if has oxlint; then
  # The command of `bun run lint:fix` names no path and ends with a segmentation fault below test/bundler/transpiler, with or without the corpus: it is given test/cli here.
  run() { ./node_modules/.bin/oxlint --config oxlint.json --fix test/cli 2>&1 | tail -1; }
  echo "oxlint, as committed: $(run); corpus files rewritten: $(git status --porcelain -- $H/corpus | grep -vc '^??')"
  git checkout -q -- test/cli
  printf '*\n' > $H/corpus/.eslintignore
  echo "oxlint, with corpus/.eslintignore '*': $(run); corpus files rewritten: $(git status --porcelain -- $H/corpus | grep -vc '^??')"
  git checkout -q -- test/cli
  rm $H/corpus/.eslintignore
fi

excluded() {
  cat > test/tsconfig.excl.json <<'EOF'
{
  "extends": "./tsconfig.json",
  "exclude": ["fixtures", "__snapshots__", "./snapshots", "./js/deno", "./node.js", "regression/issue/14477/*-mismatch.tsx", "integration/bun-types/fixture/ts7.1", "cli/lint/conformance/corpus"]
}
EOF
}

if has tsc-list; then
  excluded
  for p in test/tsconfig.json test/tsconfig.excl.json; do
    ./node_modules/.bin/tsc -p $p --listFilesOnly --incremental false --composite false > tsc-list.log 2> /dev/null || true
    echo "tsc $p: $(wc -l < tsc-list.log) files in the project, $(grep -c "/$H/corpus/" tsc-list.log) of the corpus"
  done
fi

if has tsc-full; then
  excluded
  for p in test/tsconfig.excl.json test/tsconfig.json; do
    ./node_modules/.bin/tsc -p $p --noEmit --incremental false --composite false --pretty false > tsc-full.log 2>&1 || true
    echo "tsc $p: $(grep -c 'error TS' tsc-full.log) errors, $(grep 'error TS' tsc-full.log | grep -c "$H/corpus/") in the corpus, $(grep 'error TS' tsc-full.log | grep -vc "$H/corpus/") elsewhere"
  done
fi
