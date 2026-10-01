#!/bin/sh
# usage: build.sh og|ng   -> build/<name>
set -e
cd /tmp/p12/mock
R="rustc --edition 2024 -C debuginfo=0 -C opt-level=0 --cap-lints warn"
if [ ! -f build/libbun_ast.rlib ]; then
  $R --crate-type rlib --crate-name bun_ast stubs/bun_ast.rs -o build/libbun_ast.rlib
  $R --crate-type rlib --crate-name bstr stubs/bstr.rs -o build/libbstr.rlib
  $R --crate-type rlib --crate-name bun_core stubs/bun_core.rs -o build/libbun_core.rlib
fi
rm -f src/under_test && ln -s under_test_$1 src/under_test
CFG=""; case $1 in og) CFG="--cfg og";; h2) CFG="--cfg og --cfg newtrait";; h3|h4|h5|h6) CFG="--cfg newtrait";; h7|h8|h9) CFG="--cfg newtrait --cfg tagsink";; esac
$R $CFG src/main.rs --crate-name mock_$1 -L build --extern bun_ast=build/libbun_ast.rlib --extern bstr=build/libbstr.rlib --extern bun_core=build/libbun_core.rlib -o build/$1 2>&1 | grep -v "^$" | head -${2:-80}
