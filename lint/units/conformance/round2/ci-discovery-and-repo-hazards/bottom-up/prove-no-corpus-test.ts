#!/usr/bin/env bun
// Proves that no file below test/cli/lint/conformance is taken for a test by the runner of CI, by `bun test`, or by prettier.
// usage: bun prove-no-corpus-test.ts [--repo <checkout>] [--rev <revision>] [--bun <binary>] [--no-disk]
//   --repo   a checkout of the repository (default: the one that holds the current directory)
//   --rev    the revision whose tree and whose scripts/runner.node.ts are read (default HEAD)
//   --bun    the binary whose `bun test` is run in the directories on disk (default: build/debug/bun-debug of the checkout, else this bun)
//   --no-disk  read the revision only: no walk of the directory and no `bun test`
// The predicates are cut out of scripts/runner.node.ts of the revision and evaluated: nothing of them is copied here.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const repo = path.resolve(flag("--repo") ?? git(process.cwd(), "rev-parse", "--show-toplevel").trim());
const rev = flag("--rev") ?? "HEAD";
const disk = !argv.includes("--no-disk");
const home = "test/cli/lint/conformance";

let failed = false;
const ok = (text: string) => console.log(`ok    ${text}`);
const bad = (text: string, lines: string[] = []) => {
  failed = true;
  console.log(`FAIL  ${text}`);
  for (const line of lines.slice(0, 10)) console.log(`        ${line}`);
};
const check = (holds: boolean, text: string, lines: string[] = []) => (holds ? ok(text) : bad(text, lines));

// 1. The functions of the runner, as the revision has them.
const runnerSource = git(repo, "show", `${rev}:scripts/runner.node.ts`);
const names = ["isJavaScript", "isJavaScriptTest", "isNodeTest", "isClusterTest", "isTest", "isTestStrict", "isHidden", "getTests"];
const cut = (name: string) => {
  const found = [...runnerSource.matchAll(new RegExp(`^function ${name}\\([^]*?^}$`, "gm"))];
  if (found.length !== 1) throw new Error(`scripts/runner.node.ts of ${rev} has ${found.length} functions named ${name}: this script has to follow the runner`);
  return found[0][0];
};
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(names.map(cut).join("\n"));
type Predicates = Record<"isJavaScript" | "isJavaScriptTest" | "isNodeTest" | "isClusterTest" | "isTest" | "isTestStrict" | "isHidden", (p: string) => boolean> & {
  getTests: (cwd: string) => string[];
};
// The free names of those functions: the path functions of the platform, the directory reader, and the three constants of isNodeTest.
const bind = (p: typeof path.posix, env: { isCI: boolean; isMacOS: boolean; isX64: boolean }): Predicates =>
  new Function("basename", "dirname", "join", "sep", "readdirSync", "isCI", "isMacOS", "isX64", `"use strict";\n${code}\nreturn { ${names.join(", ")} };`)(
    p.basename,
    p.dirname,
    p.join,
    p.sep,
    readdirSync,
    env.isCI,
    env.isMacOS,
    env.isX64,
  );
const anywhere = { isCI: false, isMacOS: false, isX64: false };
const posix = bind(path.posix, anywhere);
const win32 = bind(path.win32, anywhere);
console.log(`      scripts/runner.node.ts of ${git(repo, "rev-parse", "--short=10", rev).trim()}: ${names.join(", ")}`);

// 2. The predicates take what they are meant to take: a proof with predicates that take nothing proves nothing.
const controls: [keyof Omit<Predicates, "getTests">, string, boolean][] = [
  ["isTest", "cli/lint/conformance.test.ts", true],
  ["isTestStrict", "cli/lint/conformance/corpus/cases/compiler/a.test.ts", true],
  ["isTestStrict", "cli/lint/conformance/corpus/cases/compiler/a_spec.tsx", true],
  ["isTest", "cli/lint/conformance/corpus/cases/conformance/js/node/test/parallel/a.ts", true],
  ["isTest", "cli/lint/conformance/corpus/cases/conformance/js/node/test/sequential/a.js", true],
  ["isTest", "cli/lint/conformance/corpus/cases/conformance/js/bun/test/parallel/a.ts", true],
  ["isTest", "cli/lint/conformance/corpus/cases/conformance/js/node/cluster/test-a.ts", true],
  ["isTest", "cli/lint/conformance/corpus/cases/compiler/castTest.ts", false],
  ["isTest", "cli/lint/conformance/corpus/baselines/typescript/a.test.errors.txt", false],
  ["isHidden", "cli/lint/conformance/corpus/.editorconfig", true],
  ["isHidden", "cli/lint/conformance/corpus/cases/conformance/node/allowJs/a.ts", false],
];
const wrong = controls.filter(([fn, p, want]) => posix[fn](p) !== want || win32[fn](p.replaceAll("/", "\\")) !== want);
check(wrong.length === 0, `${controls.length} controls: the predicates answer as the runner's source reads`, wrong.map(([fn, p, want]) => `${fn}(${p}) is not ${want}`));

// 3. Every path of the revision below test/cli/lint, in the two forms the runner passes (below test/, and from the root), with both separators.
const tree = git(repo, "ls-tree", "-r", "--name-only", "-z", rev, "--", "test/cli/lint").split("\0").filter(Boolean);
const below = tree.filter(p => p.startsWith(`${home}/`));
const forms = (p: string) => [p, p.slice("test/".length)];
const taken = (p: string) =>
  forms(p).some(f => posix.isTest(f) || posix.isJavaScriptTest(f) || win32.isTest(f.replaceAll("/", "\\")) || win32.isJavaScriptTest(f.replaceAll("/", "\\")));
const hits = below.filter(taken);
const kinds = new Map<string, number>();
for (const p of below) {
  const top = p.slice(home.length + 1).split("/");
  const key = top[0] === "corpus" && top.length > 2 ? top.slice(0, top[1] === "lib" ? 2 : 3).join("/") : top.length > 1 ? top[0] : "(files of the directory)";
  kinds.set(key, (kinds.get(key) ?? 0) + 1);
}
console.log(`      ${below.length} paths below ${home} in ${rev}: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
check(hits.length === 0, `CI: isTest and isJavaScriptTest are false for each of the ${below.length} paths (isHidden not used)`, hits);
const siblings = tree.filter(p => !p.startsWith(`${home}/`) && posix.isTest(p.slice("test/".length)));
check(siblings.includes("test/cli/lint/conformance.test.ts"), `CI: the test files of test/cli/lint are ${siblings.map(p => path.posix.basename(p)).join(", ")}`);

// 4. The rule of `bun test` on the same paths: a model of Scanner::could_be_test_file with the suffixes of the revision. The run in 6 is the witness.
const scanner = git(repo, "show", `${rev}:src/runtime/cli/test/Scanner.rs`);
const suffixLine = /TEST_NAME_SUFFIXES: \[&\[u8\]; \d+\] = \[([^\]]*)\];/.exec(scanner);
if (suffixLine === null) throw new Error(`src/runtime/cli/test/Scanner.rs of ${rev} has no TEST_NAME_SUFFIXES: this script has to follow the scanner`);
const suffixes = [...suffixLine[1].matchAll(/b"([^"]*)"/g)].map(m => m[1]);
if (!/let name = entry\.base_lowercase\(\);/.test(scanner)) throw new Error("the scanner no longer lowers the base name: this script has to follow the scanner");
const javascriptLike = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const bunTakes = (p: string) => {
  const base = path.posix.basename(p).toLowerCase();
  const ext = path.posix.extname(base);
  return javascriptLike.has(ext) && suffixes.some(s => base.slice(0, -ext.length).endsWith(s));
};
const bunHits = below.filter(bunTakes);
check(bunTakes("a/b.TEST.ts") && bunTakes("a/b_Spec.tsx") && !bunTakes("a/castTest.ts"), `bun test (model): suffixes ${suffixes.join(" ")} on the lowered base name`);
check(bunHits.length === 0, `bun test (model): no path of the ${below.length} has such a name`, bunHits);

// 5. The glob of `bun run prettier`, from package.json of the revision.
const prettier: string = JSON.parse(git(repo, "show", `${rev}:package.json`)).scripts.prettier;
const quoted = [...prettier.matchAll(/'([^']*)'/g)].map(m => m[1]);
const wanted = quoted.filter(g => !g.startsWith("!")).map(g => new Bun.Glob(g));
const unwanted = quoted.filter(g => g.startsWith("!")).map(g => new Bun.Glob(g.slice(1)));
const bare = prettier.split(/\s+/).filter((w, i, all) => i > all.findIndex(x => x === "--write") && !w.startsWith("'") && !w.startsWith("-"));
const prettierTakes = (p: string) => (wanted.some(g => g.match(p)) && !unwanted.some(g => g.match(p))) || bare.some(d => p.startsWith(`${d}/`));
check(wanted.length > 0 && prettierTakes("test/cli/lint/conformance.test.ts"), `prettier: operands ${bare.join(" ")} ${quoted.join(" ")}; it takes test/cli/lint/conformance.test.ts`);
const prettierHits = below.filter(prettierTakes);
check(prettierHits.length === 0, `prettier: takes none of the ${below.length} paths`, prettierHits);

// 6. The refusal of sync.sh, run as sync.sh runs it, on names that each discoverer takes.
const sync = git(repo, "show", `${rev}:${home}/sync.sh`).split("\n");
const stopAt = sync.findIndex(line => line.includes('stop bad "names that a test runner of this repository takes for a test"'));
if (stopAt < 1) throw new Error("sync.sh has no refusal of test names");
const refusal = sync[stopAt - 1].replace(/ paths > bad$/, "");
const probes = [
  "corpus/cases/compiler/a.test.ts",
  "corpus/cases/compiler/a.spec.tsx",
  "corpus/cases/compiler/a_test.ts",
  "corpus/cases/compiler/a_spec.ts",
  "corpus/cases/compiler/a.Test.ts",
  "corpus/cases/compiler/a_TEST.ts",
  "corpus/cases/compiler/a.SPEC.tsx",
  "corpus/cases/compiler/a_Spec.mts",
  "corpus/cases/compiler/A.TEST.TS",
  "corpus/cases/conformance/js/node/test/parallel/a.ts",
  "corpus/cases/conformance/js/node/test/sequential/a.js",
  "corpus/cases/conformance/js/bun/test/parallel/a.tsx",
  "corpus/cases/conformance/js/node/cluster/test-a.ts",
];
const isTaken = (p: string) => taken(`${home}/${p}`) || bunTakes(p);
const refused = new Set(
  spawnSync("bash", ["-c", `rel='${home}/'; tab=$(printf '\\t'); ${refusal}`], { input: probes.join("\n") + "\n", encoding: "utf8" }).stdout.split("\n"),
);
const let_through = probes.filter(p => isTaken(p) && !refused.has(p));
check(probes.every(isTaken), `${probes.length} names that a discoverer takes`);
check(let_through.length === 0, `sync.sh line ${stopAt}: refuses each of them`, let_through);

// 7. The directory on disk: the walk of the runner and the scan of `bun test`.
if (disk) {
  const onDisk = posix.getTests(path.join(repo, "test")).filter(p => p.startsWith("cli/lint/"));
  const inside = onDisk.filter(p => p.startsWith("cli/lint/conformance/"));
  check(inside.length === 0 && onDisk.includes("cli/lint/conformance.test.ts"), `CI on disk: getTests(test) yields below cli/lint only ${onDisk.join(", ")}`, inside);
  const debug = path.join(repo, "build/debug/bun-debug");
  const exe = flag("--bun") ?? (existsSync(debug) ? debug : process.execPath);
  const env = { ...process.env, AGENT: "0", NO_COLOR: "1", BUN_DEBUG_QUIET_LOGS: "1" };
  const revision = spawnSync(exe, ["--revision"], { encoding: "utf8", env }).stdout.trim();
  for (const dir of [home, `${home}/corpus`]) {
    if (!existsSync(path.join(repo, dir))) {
      bad(`${dir} is not on disk`);
      continue;
    }
    const none = spawnSync(exe, ["test"], { cwd: path.join(repo, dir), encoding: "utf8", env });
    const filter = spawnSync(exe, ["test", "no-file-has-this-name"], { cwd: path.join(repo, dir), encoding: "utf8", env });
    const searched = /(\d+) files were searched/.exec(filter.stderr)?.[1] ?? "?";
    check(none.status === 1 && none.stderr.includes("No tests found!"), `bun test in ${dir} (${revision}): "No tests found!", exit code ${none.status}, ${searched} entries searched`, none.stderr.split("\n"));
  }
}
process.exit(failed ? 1 : 0);
