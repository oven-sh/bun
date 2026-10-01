// Evidence ledger of the parser unit: which artifact that a research finding cites exists on this machine now,
// and which surviving tool serves the step when it does not. Run it again after a restart of the machine.
//
//   bun ledger.mjs [--tsv=<file>]      prints the table, the state of the binaries and the tool of each step
//
// A row: step, artifact, who cites it, what it is for, what replaces it when it is absent.
// "cited by" names the findings as the research passes named them. The thirteen findings that name the binary
// 8965734d5 (bootstrap-and-test-seam, verification-harness, type-grammar-core, type-grammar-members-params-args,
// decorator-metadata, type-nodes, sidecar-model-rewind, lexer-comments-directives, lint-entry,
// strict-mode-and-diagnostic-codes, area-expressions, area-functions-classes, area-statements-modules) are "G13".
import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";

const U = "/workspace/notes/lint/units/parser";
const ROWS = [
  // binaries
  ["bin", "/workspace/bun/build/release/bun", "every finding (the `bun` on PATH)", "the installed release binary: tests of P1.6 must fail on it", "-"],
  ["bin", "/workspace/notes/lint/measure/pr2/bun.pr2b", "G13", "stable copy of the installed binary 8965734d5", "the commit is not in the repository; use `bun` on PATH (367d939d9, before the sink grammar)"],
  ["bin", "/workspace/notes/lint/measure/pr2/bun-profile.pr2b", "G13", "profile twin of 8965734d5", `${U}/measure/base/bin/bun-profile (e3566be889)`],
  ["bin", `${U}/base/bun-debug-e3566be889`, "verification-harness", "saved debug build of the clean worktree", "/workspace/wt/parser/build/debug/bun-debug"],
  ["bin", "/workspace/wt/parser/build/debug/bun-debug", "verification-harness", "debug build of e3566be889", "-"],
  ["bin", `${U}/measure/base/bin/bun`, "base measurements", "release build of e3566be889, the base of every comparison (git-ignored)", "/workspace/wt/parser/build/release/bun while the worktree is clean, else rebuild"],
  ["bin", `${U}/measure/base/bin/bun-profile`, "base measurements", "release build with symbols of e3566be889 (git-ignored)", "/workspace/wt/parser/build/release/bun-profile while the worktree is clean, else rebuild"],
  ["bin", "/tmp/rr/go126/bin/go", "typecheck unit, ts-dump-and-test-importer", "Go 1.26 built from source (volatile)", "units/typecheck/ts-dump-and-test-importer/groundtruth/build.sh rebuilds it"],
  ["bin", "/tmp/rr/bin/tsgo", "G13", "typescript-go binary used for executed reference results", `${U}/ledger/top-down/tsgo-oracle/build.sh builds /tmp/rr/parsediag (parse diagnostics); /tmp/rr/dumpast prints trees`],
  ["bin", "/tmp/rr/parsediag", "this ledger", "parse oracle of typescript-go 89d5d5b (volatile)", `${U}/ledger/top-down/tsgo-oracle/build.sh`],
  // P1.1 probes
  ["P1.1", `${U}/probes/probe.mjs`, "verification-harness", "the one probe script (3,381 inputs, six groups)", `${U}/ledger/top-down/corpus/run.sh`],
  ["P1.1", `${U}/probes/upstream-verdicts.json`, "verification-harness", "verdicts of the inventory run; reproduces 625/326/114/68/117 and the five other totals", "none: the inventory inputs are lost, the totals cannot be reproduced"],
  ["P1.1", `${U}/probes/upstream`, "verification-harness", "raw copy of the inventory run", "none"],
  ["P1.1", `${U}/probes/results`, "verification-harness", "report, records, set A and set B lists per pass", `${U}/ledger/top-down/corpus/out`],
  ["P1.1", `${U}/probes/inputs/type-forms`, "verification-harness", "one of six input directories", `${U}/probes/inputs/01-type-forms.mjs and the merged corpus`],
  ["P1.1", `${U}/probes/make_rows.mjs`, "verification-harness", "Bun output against tsc emit for inputs both accept (1,810 same, 149 differ, 18 not reprintable)", `none for the numbers; ${U}/probes/candidates.mjs builds test rows`],
  ["P1.1", `${U}/probes/existing-tests/record-transpiler-calls.js`, "verification-harness", "records every transformSync call of a test file", `${U}/ledger/top-down/corpus/record-transpiler-calls.js`],
  ["P1.1", `${U}/probes/existing-tests/record-bundler-files.js`, "verification-harness", "records the files of the itBundled cases", `static scan of bundleErrors in ${U}/ledger/top-down/corpus/pinned.mjs; ${U}/probes/existing-tests.mjs for the decorator cases`],
  ["P1.1", `${U}/probes/type-grammar-core`, "type-grammar-core", "probe directory of the finding", `${U}/ledger/rescued-tmp/gct1a-42866 (spot probes), the merged corpus`],
  ["P1.1", `${U}/probes/members-params-args`, "type-grammar-members-params-args", "probe directory of the finding", "the merged corpus (families bu/02, bu/03, bu/04, td/02..04)"],
  ["P1.1", `${U}/probes/area-expressions`, "area-expressions", "probe directory of the finding", "the merged corpus (bu/05, td/05, otg)"],
  ["P1.1", `${U}/probes/area-functions-classes`, "area-functions-classes", "probe directory of the finding", "the merged corpus (bu/03, bu/06, bu/09, td/06, td/09)"],
  ["P1.1", `${U}/probes/area-statements-modules`, "area-statements-modules", "probe directory of the finding", "the merged corpus (bu/07, bu/08, bu/10, td/07, td/08, td/10)"],
  ["P1.1", `${U}/probes/run.mjs`, "tsc-oracle-probes (bottom-up)", "probe runner over probes/inputs/NN-*.mjs, installed binary only", "-"],
  ["P1.1", `${U}/probes/out/raw/01-type-forms.jsonl.gz`, "tsc-oracle-probes (bottom-up)", "results with the installed 367d939d9", "-"],
  ["P1.1", `${U}/probes/top-down/runner.mjs`, "tsc-oracle-probes (top-down)", "probe runner with --bun <binary>, causes.mjs names the place in Bun and the production", "-"],
  ["P1.1", `${U}/probes/top-down/results/classes.tsv`, "tsc-oracle-probes (top-down)", "classes with the installed 367d939d9", "-"],
  ["P1.1", `${U}/probes/outside-type-grammar/probe.mjs`, "outside-type-grammar", "spot probe, one input per line", "-"],
  ["P1.1", "/tmp/gct1a-42866", "grammar spot probes (bottom-up)", "inputs that existed only under /tmp", `${U}/ledger/rescued-tmp/gct1a-42866`],
  ["P1.1", "/tmp/otg_bottomup_7f3k", "outside-type-grammar (bottom-up)", "inputs that existed only under /tmp", `${U}/ledger/rescued-tmp/otg_bottomup_7f3k`],
  ["P1.1", `${U}/ledger/top-down/corpus/run.sh`, "this ledger", "THE TOOL OF P1.1: one corpus (327,745 sources), any binary, tsc, typescript-go, checker classes, pinned tests", "-"],
  ["P1.1", `${U}/ledger/bottom-up/run.sh`, "evidence ledger (bottom-up pass)", "a second pipeline with the same stages, built in parallel: its pin classes agree with flips.tsv (101: A1v 13, A1j 1, A2 77, A3 10)", "-"],
  // P1.3 metadata
  ["P1.3", `${U}/probes/decorator-metadata`, "decorator-metadata", "metadata model with its 130 test rows", `${U}/probes/out/metadata.table.tsv (16,149 rows: Bun, tsc with strictNullChecks off, tsc defaults)`],
  ["P1.3", `${U}/probes/metadata_tags.mjs`, "verification-harness", "reduces a printed tag to a name", `${U}/probes/metadata.mjs (normal form of a tag)`],
  ["P1.3", `${U}/probes/metadata.mjs`, "tsc-oracle-probes (bottom-up)", "THE TOOL OF P1.3: table, differences and causes from out/11-metadata.jsonl (run.mjs 11 with the binary under test)", "-"],
  ["P1.3", `${U}/probes/out/metadata.table.tsv`, "tsc-oracle-probes (bottom-up)", "input, form, position, Bun, tsc loose, tsc strict, same", "-"],
  ["P1.3", `${U}/probes/out/metadata.diff.tsv`, "tsc-oracle-probes (bottom-up)", "the 1,750 rows where Bun and tsc differ, 18 causes in metadata.summary.txt", "-"],
  ["P1.3", `${U}/probes/top-down/results/metadata.tsv`, "tsc-oracle-probes (top-down)", "5,399 rows with verdict, Bun, tsc, tsc with strictNullChecks off", "-"],
  // P1.6 test file
  ["P1.6", `${U}/probes/typescript-grammar.test.template.ts`, "verification-harness", "verified layout of the test file", `${U}/probes/out/candidates.typescript-grammar.test.ts with candidates.mjs`],
  ["P1.6", `${U}/probes/out/candidates.typescript-grammar.test.ts`, "tsc-oracle-probes (bottom-up)", "candidate test file generated from the probe results", "-"],
  ["P1.6", `${U}/probes/top-down/results/test-candidates.json.gz`, "tsc-oracle-probes (top-down)", "rows that fail on the probed binary with the output they must print; verify-candidates.mjs", "-"],
  // P1.7 differential harness
  ["P1.7", `${U}/grammar-diff/harness.mjs`, "grammar-diff", "THE TOOL OF P1.7: 15 configurations of Bun.Transpiler over a corpus, run by the binary under test", "-"],
  ["P1.7", `${U}/grammar-diff/diff.mjs`, "grammar-diff", "compares two runs, gives every differing record to a cause (causes.mjs), exit 1 on A>R or unexplained", "-"],
  ["P1.7", `${U}/grammar-diff/gen.mjs`, "grammar-diff", "generates the corpus from productions, valid and with one token changed", "-"],
  ["P1.7", `${U}/grammar-diff/corpus.small.json`, "grammar-diff", "209,628 sources", "-"],
  ["P1.7", `${U}/measure/base/grammar-diff/base.small.jsonl.gz`, "base measurements", "run of the base build e3566be889 (the left side of every later diff)", "rerun harness.mjs with the base binary"],
  ["P1.7", `${U}/measure/base/grammar-diff/installed-367d939d9.small.jsonl.gz`, "base measurements", "run of the installed binary", "-"],
  ["P1.7", `${U}/grammar-diff/oracle.small.jsonl.gz`, "grammar-diff", "tsc parse diagnostics and metadata of every source", "-"],
  // P2
  ["P2", "/workspace/notes/lint/tools/symsizes.py", "COMMON.md", "parser symbol sizes by address", "-"],
  ["P2", "/workspace/notes/lint/tools/cgbench.sh", "COMMON.md", "THE TOOL OF P2 (with symsizes.py): instruction and branch counts of the benchmark under valgrind", "-"],
  ["P2", "/workspace/notes/lint/tools/cgsum.py", "COMMON.md", "sums a cachegrind file", "-"],
  ["P2", "/workspace/tools/valgrind/bin/valgrind", "COMMON.md", "valgrind for cgbench.sh", "sh /workspace/notes/lint/tools/bootstrap.sh"],
  ["P2", `${U}/measure/symdiff.py`, "base measurements", "sizes of bun_js_parser symbols of two binaries by demangled name", "-"],
  ["P2", `${U}/measure/grammar-syms.py`, "base measurements", "every text symbol of the type grammar with size and address", "-"],
  ["P2", `${U}/measure/tools/cgdiff.py`, "base measurements", "per-symbol difference of two cachegrind files", "-"],
  ["P2", `${U}/measure/base/symsizes.b.txt`, "base measurements", "base values of the symbol groups", "-"],
  ["P2", `${U}/measure/base/grammar-syms.b.txt`, "base measurements", "base values per grammar function", "-"],
  ["P2", `${U}/measure/base/cg-b/b-run1.tsx.cg`, "base measurements", "base cachegrind files (git-ignored)", "rerun cgbench.sh with the base profile binary; the .log files beside them are committed"],
  ["P2", `${U}/build-sink-positions/fncmp.py`, "build-sink-positions", "function disassembly comparer (check of sink neutrality without a full build)", "-"],
  ["P2", `${U}/probes/type-nodes`, "type-nodes", "probe directory of the finding", `${U}/type-nodes-layout, ${U}/build-sink-positions/type-nodes-prototype, ${U}/ledger/rescued-tmp/tsnodes`],
  ["P2", "/tmp/tsnodes", "type-nodes layout", "layout experiments (61 MB, volatile)", `${U}/type-nodes-layout and ${U}/ledger/rescued-tmp/tsnodes (sources only)`],
  // P3
  ["P3.3", `${U}/probes/lexer-comments`, "lexer-comments-directives", "probe directory of the finding", `${U}/lexer-lint-hooks/{bottom-up,top-down} (comments, pragmas), ${U}/ledger/rescued-tmp/lexhooks`],
  ["P3.3", "/tmp/lexprobe", "lexer-comments-directives", "lexer probes", `${U}/lexer-lint-hooks`],
  ["P3.3", "/tmp/lexhooks", "lexer-lint-hooks", "probes that existed only under /tmp", `${U}/ledger/rescued-tmp/lexhooks`],
  ["P3.1", `${U}/probes/lint-entry`, "lint-entry", "probe directory of the finding", `${U}/lint-entry-probe, ${U}/ledger/rescued-tmp/lint-entry-probe`],
  ["P3.1", "/tmp/lint-entry-probe", "lint-entry-probe", "probes that existed only under /tmp", `${U}/ledger/rescued-tmp/lint-entry-probe`],
  ["P3.4", "/tmp/sidecar-research", "sidecar-model-rewind", "work directory of the finding", `${U}/sidecar-core, ${U}/ledger/rescued-tmp/sidecar-probe`],
  ["P3.4", "/tmp/sidecar-probe", "sidecar probes", "probes that existed only under /tmp", `${U}/ledger/rescued-tmp/sidecar-probe`],
  ["P3.4", "/tmp/sidl", "sidecar probes", "JSX rule probe", `${U}/ledger/rescued-tmp/sidl`],
  ["P3.5", `${U}/probes/diag-codes`, "strict-mode-and-diagnostic-codes", "711 first-code rows of rejected inputs", `${U}/ledger/top-down/corpus/out/first-codes.tsv.gz (188,925 rows)`],
  ["P3.5", `${U}/ledger/top-down/corpus/out/first-codes.tsv.gz`, "this ledger", "THE TABLE OF P3.5: first diagnostic of typescript-go and of tsc per rejected source, beside the Bun message and offset", "-"],
  ["P3.5", `${U}/lexer-lint-hooks/bottom-up/reference-parseErrorAt-sites.tsv`, "lexer-lint-hooks (bottom-up)", "every parseErrorAt site of the reference parser", "-"],
  ["P3.5", `${U}/lexer-lint-hooks/bottom-up/codes-probe.mjs`, "lexer-lint-hooks (bottom-up)", "tsc codes of labelled inputs per Bun error site", "-"],
  ["P3.5", `${U}/probes/out/strict-grammar.B.tsv`, "tsc-oracle-probes (bottom-up)", "set B with tsc codes (installed binary)", `${U}/ledger/top-down/corpus/out/setB.tsv.gz`],
  ["boot", "/tmp/parser-bootstrap", "bootstrap-and-test-seam", "work directory of the finding", `${U}/measure/base/logs (build, check, clippy, fmt and test logs of the base)`],
  ["boot", `${U}/tools`, "G13", "tools directory of the unit", `${U}/measure/tools, ${U}/ledger`],
  ["boot", `${U}/verify`, "verification-harness", "verification scripts", `${U}/ledger/top-down/corpus/run.sh, ${U}/grammar-diff`],
];

const sh = (cmd, args) => {
  const p = spawnSync(cmd, args, { encoding: "utf8" });
  return (p.stdout ?? "").trim();
};
const lines = ["step\tstate\tartifact\tcited by\twhat it is\treplacement"];
let absent = 0;
for (const [step, path, by, what, repl] of ROWS) {
  const ok = existsSync(path);
  if (!ok) absent++;
  let state = ok ? "present" : "ABSENT";
  if (ok && statSync(path).isFile()) state += ` ${statSync(path).size}`;
  lines.push([step, state, path, by, what, repl].join("\t"));
}
const out = lines.join("\n") + "\n";
const tsvPath = process.argv.find(a => a.startsWith("--tsv="))?.slice(6);
if (tsvPath) writeFileSync(tsvPath, out);
console.log(out);
console.log(`${ROWS.length} artifacts, ${absent} absent`);
console.log("");
console.log(`bun on PATH: ${sh("bun", ["--revision"])}  sha256 ${sh("sha256sum", [sh("sh", ["-c", "readlink -f $(which bun)"])]).slice(0, 16)}`);
for (const b of [`${U}/measure/base/bin/bun`, "/workspace/wt/parser/build/release/bun", "/workspace/wt/parser/build/debug/bun-debug"]) {
  if (existsSync(b)) console.log(`${b}: sha256 ${sh("sha256sum", [b]).slice(0, 16)}`);
}
console.log(`worktree /workspace/wt/parser: HEAD ${sh("git", ["-C", "/workspace/wt/parser", "rev-parse", "--short=10", "HEAD"])}, ${sh("git", ["-C", "/workspace/wt/parser", "status", "--porcelain"]) === "" ? "clean" : "DIRTY"}`);
console.log(`commit 8965734d5 in the repository: ${spawnSync("git", ["-C", "/workspace/wt/parser", "cat-file", "-e", "8965734d5"]).status === 0 ? "yes" : "no"}`);
console.log(`typescript-go reference: ${sh("git", ["-C", "/workspace/ref/typescript-go", "rev-parse", "--short", "HEAD"])}`);
