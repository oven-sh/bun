#!/usr/bin/env bash
# usage: bash mutations.sh <scratch clone with the corpus>
# Shows that the candidate describe fails for each hazard it guards, as a full build and as a debug build sees it.
# The candidate runs as a plain script (repository-shim.ts stands for bun:test and harness; SMALL=1 is a debug build):
# nothing here is a test run or a build. Every change of the scratch clone is undone.
set -u
scratch=$(cd -- "${1:?usage: mutations.sh <scratch clone>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$scratch/test/cli/lint" || exit 1
cp "$here/repository-shim.ts" repository-shim.ts
sed -e 's#from "bun:test"#from "./repository-shim.ts"#' -e 's#from "harness"#from "./repository-shim.ts"#' "$here/repository-describe.candidate.ts" > repository-proto.script.ts
C=conformance/corpus/cases
run() {
  echo "--- $1"
  for small in 0 1; do
    SMALL=$small bun repository-proto.script.ts 2>&1 | sed -e 's/  [0-9]* ms cpu  [0-9]* ms wall//' -e "s/^/  $([ $small = 1 ] && echo 'debug' || echo 'full ') /" | cut -c1-260
  done
}
run "the clone as it is: four tests pass"
: > $C/compiler/zz.test.ts; run "a file named zz.test.ts"; rm $C/compiler/zz.test.ts
mkdir -p $C/conformance/js/node/test/parallel && : > $C/conformance/js/node/test/parallel/zz.ts; run "a file below js/node/test/parallel"; rm -r $C/conformance/js
mkdir -p $C/conformance/node_modules && : > $C/conformance/node_modules/x.ts; run "a directory node_modules"; rm -r $C/conformance/node_modules
mkdir -p $C/.hidden && : > $C/.hidden/x.ts; run "a directory that starts with a dot"; rm -r $C/.hidden
: > $C/compiler/A_Test.ts; run "a file named A_Test.ts, which only bun test takes"; rm $C/compiler/A_Test.ts
: > conformance/corpus/.gitignore; : > $C/.DS_Store; run "files that start with a dot: four tests pass"; rm conformance/corpus/.gitignore $C/.DS_Store
cp "$scratch/scripts/runner.node.ts" /tmp/runner.node.ts.$$
sed -i 's#return isJavaScript(path) \&\& /\\.test|spec\\./.test(basename(path));#return isJavaScript(path) \&\& /\\.test|spec\\.|Test\\./.test(basename(path));#' "$scratch/scripts/runner.node.ts"
run "the runner takes base names with Test. as well"
cp /tmp/runner.node.ts.$$ "$scratch/scripts/runner.node.ts"; rm /tmp/runner.node.ts.$$
rm repository-proto.script.ts repository-shim.ts
