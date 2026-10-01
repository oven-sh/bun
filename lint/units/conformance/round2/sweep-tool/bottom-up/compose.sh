#!/usr/bin/env bash
# usage: compose.sh <tree>
# Lays over a tree with the conformance runner of 3110ce85cf, in this order: the binding of ../../corpus-glue/top-down/verified,
# the contract of ../../default-check-contract/bottom-up with its sweep-handoff.patch, and sweep-tool.patch of this directory.
# Where two of them change the same lines, this script says what the lines become. It proves that the three go together;
# the tree is a scratch clone of ../../scratch.sh or a copy of test/cli/lint of the worktree.
set -euo pipefail
tree=$(cd -- "${1:?usage: compose.sh <tree>}" && pwd)
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
round=$(cd -- "$here/../.." && pwd)
home=$tree/test/cli/lint/conformance
cd "$tree"
for p in index.ts.patch run.ts.patch sweep.ts.patch conformance.test.ts.patch; do patch -p1 -s < "$round/corpus-glue/top-down/verified/$p"; done
cp "$round/corpus-glue/top-down/verified/corpus.ts" "$home/runner/corpus.ts"
cp "$round/default-check-contract/bottom-up/expectations.json" "$home/expectations.json"
patch -p1 -s -f < "$round/default-check-contract/bottom-up/default-check-contract.patch" > /dev/null || true
patch -p1 -s -f < "$round/default-check-contract/bottom-up/sweep-handoff.patch" > /dev/null || true
patch -p1 -s -f < "$here/sweep-tool.patch" > /dev/null || true
find test/cli/lint -name '*.rej' -delete -o -name '*.orig' -delete
python3 - "$home" "$here" <<'PY'
import sys
home, here = sys.argv[1], sys.argv[2]
def edit(path, pairs):
    s = open(path, encoding="utf8").read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    open(path, "w", encoding="utf8").write(s)
# corpus-glue and the contract both add exports of run.ts.
edit(f"{home}/runner/index.ts", [
    ('export { emptyCheck, outcomes, replayCheck, runInstance, runInstances } from "./run";',
     'export { emptyCheck, outcomes, replayCheck, runInstance, runInstances, verdictOutcomes } from "./run";'),
    ("  CheckResult,\n  InputResult,\n", "  CheckResult,\n  Death,\n  InputResult,\n"),
    ("  Symlink,\n} from \"./run\";", "  Symlink,\n  Verdict,\n} from \"./run\";"),
])
sweep = f"{home}/sweep.ts"
s = open(sweep, encoding="utf8").read()
# The run of the instances: the whole block of this unit, with the instances and the corpus of corpus-glue and the level of the contract.
mine = open(f"{here}/sweep.ts", encoding="utf8").read()
start, end = "  // What a run says besides its outcomes:", "  const results = ran.map(fact => resultOf.get(fact.name)!);"
block = mine[mine.index(start):mine.index(end)]
for old, new in [
    ("{ instance: fact.run!, ...rest }", "{ instance: fact.instance, ...rest }"),
    ("readOracle(fact.run!.oracle)", "corpus.oracle(fact.instance)"),
    ("toRun.map(fact => fact.run!)", "toRun.map(fact => fact.instance)"),
    ("input: (instance, root) => inputOf(paths, instance as RunInstance, root),", "input: (instance, root) => corpus.input(instance, root),"),
    ("oracle: instance => readOracle((instance as RunInstance).oracle),", "oracle: instance => corpus.oracle(instance),"),
    ("        timeoutMs: o.timeoutMs,\n", "        timeoutMs: o.timeoutMs,\n        level: lists.level,\n"),
]:
    assert block.count(old) == 1, old
    block = block.replace(old, new)
a = s.index("  say(`check ${checked.name}`);\n  const directory = o.files && ran.length > 0")
s = s[:a] + block + s[s.index(end):]
open(sweep, "w", encoding="utf8").write(s)
edit(sweep, [
    # One import of node:fs; the probe of the contract.
    ('// The sweep: the instances of the corpus through a check, the pass counts by directory and by diagnostic code, the lists of expectations.json and a report file.\nimport { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
     '// The sweep: the instances of the corpus through a check, their outcomes by directory and by diagnostic code, the lists of expectations.json and a report file; or one line for each instance.\nimport { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";'),
    ('import { createSpawnCheck } from "./runner/check_bun_lint";', 'import { createSpawnCheck, probe } from "./runner/check_bun_lint";'),
    # The sentence of the exit codes, with what both add.
    ("Exit code 0: every listed instance of the selection passes and no name left a list that may hold it; with --round-trip,\nevery error baseline is written back with its bytes. 1: not so. 2: the command line is wrong, or the corpus, the lists,\nthe module of the check or the file of the report cannot be used, or the binary of the default check is no linter.`;",
     "Exit code 0: every listed instance of the selection passes and no name left a list that may hold it; with --each,\nevery instance of the selection that the reference runs passes; with --round-trip, every error baseline is written\nback with its bytes. 1: not so. 2: the command line is wrong, or the corpus, the lists, the module of the check, the\nfile of --resume or the file of the report cannot be used, or the binary of the default check is no linter.`;"),
    ("interface Options {\n  selectors: string[];\n  bin: string | undefined;\n  check: string | undefined;\n  files: boolean;\n  jobs: number | undefined;\n  timeoutMs: number;\n",
     "interface Options {\n  selectors: string[];\n  each: boolean;\n  bin: string | undefined;\n  check: string | undefined;\n  files: boolean;\n  jobs: number | undefined;\n  timeoutMs: number;\n  shard: { part: number; of: number } | undefined;\n  resume: string | undefined;\n"),
    # The hand-off counts the outcomes of a directory for the report as this unit does for its table: one of the two.
    ("    directoryOutcomes: Object.fromEntries(\n      [...directories.keys()].map(directory => {\n        const inDirectory = (all: readonly Fact[]) => all.filter(fact => fact.directory === directory);\n        const counts = {\n          E: Object.fromEntries(outcomesOf(inDirectory(ranE))),\n          C: Object.fromEntries(outcomesOf(inDirectory(ranC))),\n        };\n        return [directory, counts];\n      }),\n    ),\n",
     "    directoryOutcomes: Object.fromEntries(directoryOutcomes),\n"),
])
PY
cp "$here"/*-check-fixture.ts "$home/fixtures/" 2>/dev/null || true
echo "composed in $tree"
