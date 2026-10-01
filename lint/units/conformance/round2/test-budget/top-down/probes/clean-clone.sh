#!/usr/bin/env bash
# usage: clean-clone.sh <directory> [revision]   (default revision: HEAD of /workspace/wt/conformance)
# A clone of a commit with only what test/cli/lint/conformance.test.ts needs, and nothing that the commit does not hold:
# sync.sh is not run. The worktree has the files that sync.sh wrote whether they are committed or not, and one of them
# (corpus/cases/conformance/parser/ecmascript5/parserSyntaxWalker.generated.ts) is matched by .gitignore:139, so a run in
# the worktree does not show what a checkout of CI has. This prints what the commit lacks; then run the file here:
#   /workspace/tools/lk bash batch1.sh <directory> <out> clean
set -euo pipefail
dir=${1:?usage: clean-clone.sh <directory> [revision]}
rev=$(git -C /workspace/wt/conformance rev-parse "${2:-HEAD}")
git clone -q --shared --no-checkout /workspace/bun "$dir"
cd "$dir"
git sparse-checkout init --no-cone
git sparse-checkout set '/test/cli/lint/' '/test/harness.ts' '/test/preload.ts' '/test/_util/' '/test/tsconfig.json' \
  '/test/bunfig.toml' '/test/leaksan.supp' '/tsconfig.base.json' '/bunfig.toml' '/package.json' '/.gitignore' \
  '/.gitattributes' '/.prettierrc' '/.prettierignore' '/scripts/runner.node.ts'
git checkout -q --detach "$rev"
home=test/cli/lint/conformance
want=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).corpus.files)' "$home/reference_counts.json")
have=$(git ls-files "$home/corpus" | wc -l)
echo "commit $rev: $have files below corpus/, reference_counts.json says $want"
for file in UPSTREAM expectations.json runner/corpus.ts; do
  [ -f "$home/$file" ] || echo "MISSING in the commit: $home/$file"
done
[ "$have" = "$want" ] || echo "NOT THE CORPUS: the commit lacks $((want - have)) files"
git status --short | head -5
