#!/bin/sh
# Reproduces the oracle files of this directory. Nothing here touches a worktree.
# 1. typescript-go 89d5d5b as a command: /tmp/rr/parsediag-bu (ledger/bottom-up/tsgo-oracle/build.sh builds it).
# 2. The lint-parse probe, a crate outside the worktree that depends on its bun_js_parser by path (a cargo build: through the lock):
#      /workspace/tools/lk lintprobe/run.sh /workspace/wt/parser inputs.json lint.head.txt
#    then, without the lock, for the other input files:
#      /tmp/smph-target/debug/lintprobe <file of "loader TAB hex(source)" lines> > lintN.head.txt
# 3. Per input: tsc 6.0.2 (parser, then checker), typescript-go, the lint parse, and the parse without lint of the bun that runs it.
cd "$(dirname "$0")" || exit 1
BUN=${BUN:-/workspace/wt/parser/build/release/bun}
tohex() { node -e 'const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(a.map(r => (r.l || "ts") + "\t" + Buffer.from(r.s, "utf8").toString("hex")).join("\n") + "\n");' "$1"; }
node make-inputs.cjs > inputs.json; node make-inputs2.cjs > inputs2.json; node make-inputs3.cjs > inputs3.json
for n in "" 2 3; do
  tohex inputs$n.json > /tmp/smph-probe/inputs$n.hex
  /tmp/smph-target/debug/lintprobe /tmp/smph-probe/inputs$n.hex > lint$n.head.txt
  "$BUN" digest-lint.cjs inputs$n.json lint$n.head.txt > digest-lint${n:-1}.txt
  "$BUN" digest.cjs inputs$n.json --go /tmp/rr/parsediag-bu > digest-plain${n:-1}.txt
  node tree-diff.cjs inputs$n.json lint$n.head.txt > tree-diff${n:-1}.head.txt
done
# 4. The rows of the Rust tests, with the values of tsc 6.0.2 and a mark where typescript-go differs (none does):
node make-test-rows.cjs --go /tmp/rr/parsediag-bu > test-rows.txt
