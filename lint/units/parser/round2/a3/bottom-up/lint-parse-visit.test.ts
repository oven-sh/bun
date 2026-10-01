import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// With debug assertions, `Parser::parse` reads BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT and then gives its parse pass the
// side table of `Parser::parse_for_lint` (type nodes, strict grammar) before the unchanged visit pass and printer.
// What is printed must be what the normal transpile prints, for every TypeScript file under test/ and src/js that
// parses. A release build has no such switch, so this is skipped there. A build with debug assertions and without
// the switch fails at the sentinel, which only a lint parse rejects.

const root = join(import.meta.dir, "..", "..", "..");
const sentinel = "let x: (a: ) => void;\n";
const shardCount = 4;

const worker = String.raw`
const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, sentinel, files, withCode } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = [
  { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) },
  { ts: new Bun.Transpiler({ loader: "ts", tsconfig }), tsx: new Bun.Transpiler({ loader: "tsx", tsconfig }) },
];
const out = fs.openSync(outPath, "w");
const digest = bytes => bytes.length + ":" + Bun.hash(bytes).toString(16);
function transform(index, config, loader, source, withCode) {
  // The line before the result names the file that a crash is in.
  fs.writeSync(out, JSON.stringify({ start: index, config }) + "\n");
  const record = { index, config, source: digest(source) };
  try {
    const code = transpilers[config][loader].transformSync(source);
    record.output = digest(code);
    if (withCode) record.code = code;
  } catch (e) {
    record.errors = (e?.errors ?? [e]).map(error => String(error?.message ?? error));
  }
  fs.writeSync(out, JSON.stringify(record) + "\n");
}
transform(-1, 0, "ts", Buffer.from(sentinel), true);
for (const [index, file, configs] of files) {
  let source;
  try {
    source = fs.readFileSync(root + "/" + file);
  } catch {
    continue;
  }
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  // A line that starts with a decorator: once more with experimental decorators and their metadata.
  const decorated = /^[ \t]*@[A-Za-z_$(]/m.test(source.latin1Slice());
  for (const config of configs ?? (decorated ? [0, 1] : [0])) transform(index, config, loader, source, withCode);
}
fs.closeSync(out);
`;

/** One result line of a child: what `transformSync` gave for the file at `index`, or for the sentinel at -1. */
type Line = { index: number; config: number; source: string; output?: string; code?: string; errors?: string[] };

let found: string[] | undefined;
/** Every TypeScript file under test/ and src/js, sorted: a child gets a file with its index here. */
function filesToCompare(): string[] {
  if (found) return found;
  const files: string[] = [];
  for (const dir of ["test", "src/js"]) {
    for (const file of new Glob("**/*.{ts,tsx,mts,cts}").scanSync({ cwd: join(root, dir) })) {
      const path = `${dir}/${file.replaceAll("\\", "/")}`;
      // An installed package is no part of the claim.
      if (!path.includes("/node_modules/")) files.push(path);
    }
  }
  return (found = files.sort());
}

const nameOf = (index: number, config: number) =>
  `${filesToCompare()[index] ?? "<sentinel>"}${config ? " (experimental decorators with metadata)" : ""}`;

/** Runs one child over `files` and reads what it wrote. `lint`: with the parse pass of a lint parse. */
async function run(dir: string, name: string, lint: boolean, list: { files: unknown[]; withCode?: boolean }) {
  await Bun.write(join(dir, `${name}.list.json`), JSON.stringify({ root, sentinel, ...list }));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "worker.js", `${name}.list.json`, `${name}.jsonl`],
    cwd: dir,
    env: lint ? { ...bunEnv, BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT: "1" } : bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let text = "";
  try {
    text = readFileSync(join(dir, `${name}.jsonl`), "utf8");
  } catch {}
  const lines = text.split("\n").filter(Boolean);
  const last = lines.length % 2 === 1 ? JSON.parse(lines[lines.length - 1]) : undefined;
  const crash =
    exitCode === 0 && last === undefined && lines.length > 0
      ? undefined
      : {
          child: name,
          exitCode,
          signalCode: proc.signalCode,
          at: last ? nameOf(last.start, last.config) : "outside a file",
          stderr: stderr.slice(-4000),
        };
  const records = new Map<string, Line>();
  for (let i = 1; i < lines.length; i += 2) {
    const line: Line = JSON.parse(lines[i]);
    records.set(`${line.index}:${line.config}`, line);
  }
  return { records, crash };
}

describe.skipIf(!isDebug && !isASAN)("a lint parse, visited and printed, is the normal transpile", () => {
  for (let shard = 0; shard < shardCount; shard++) {
    test.concurrent(
      `of the TypeScript files under test/ and src/js, part ${shard + 1} of ${shardCount}`,
      async () => {
        const files = filesToCompare();
        expect(files.length).toBeGreaterThan(3000);
        const mine = files
          .map((file, index) => [index, file] as const)
          .filter(([index]) => index % shardCount === shard);
        using dir = tempDir("lint-parse-visit", { "worker.js": worker });

        // Without lint first: only what that parse takes is given to the lint parse.
        const normal = await run(String(dir), "normal", false, { files: mine });
        const taken = new Map<number, number[]>();
        let rejected = 0;
        for (const line of normal.records.values()) {
          if (line.index === -1) continue;
          if (line.errors) rejected += line.config === 0 ? 1 : 0;
          else taken.set(line.index, [...(taken.get(line.index) ?? []), line.config]);
        }
        const again = [...taken].map(([index, configs]) => [index, files[index], configs]);
        const lint = await run(String(dir), "lint", true, { files: again });

        // A file that another test removed or wrote between the readings is not compared.
        const unread = mine.filter(([index]) => !normal.records.has(`${index}:0`)).length;
        const counts = { files: mine.length, equal: 0, rejected, changed: unread, decorated: 0, decoratedEqual: 0 };
        const differing: { file: string; index: number; config: number }[] = [];
        const onlyWithoutLint: unknown[] = [];
        for (const [key, n] of normal.records) {
          const l = lint.records.get(key);
          if (n.index === -1 || n.errors) continue;
          if (n.config) counts.decorated++;
          if (l === undefined || n.source !== l.source) counts.changed += n.config === 0 ? 1 : 0;
          else if (l.errors) onlyWithoutLint.push({ file: nameOf(n.index, n.config), errors: l.errors });
          else if (n.output !== l.output)
            differing.push({ file: nameOf(n.index, n.config), index: n.index, config: n.config });
          else if (n.config) counts.decoratedEqual++;
          else counts.equal++;
        }

        // The first files that differ once more, with what was printed: where the two first differ.
        let differences: unknown[] = differing.map(({ file }) => file);
        if (differing.length > 0) {
          const some = {
            files: differing.slice(0, 5).map(({ index, config }) => [index, files[index], [config]]),
            withCode: true,
          };
          const [n, l] = [
            await run(String(dir), "normal-code", false, some),
            await run(String(dir), "lint-code", true, some),
          ];
          differences = differing.map(({ file, index, config }) => {
            const [a, b] = [n.records.get(`${index}:${config}`)?.code, l.records.get(`${index}:${config}`)?.code];
            if (a === undefined || b === undefined || a === b) return file;
            let at = 0;
            while (a[at] === b[at]) at++;
            return {
              file,
              at,
              normal: a.slice(Math.max(0, at - 80), at + 80),
              lint: b.slice(Math.max(0, at - 80), at + 80),
            };
          });
        }

        console.log(
          `lint parse, visited and printed, part ${shard + 1} of ${shardCount}: ${counts.equal} of ${counts.files} files equal` +
            ` (and ${counts.decoratedEqual} of ${counts.decorated} again with experimental decorators),` +
            ` ${differing.length} differing, ${onlyWithoutLint.length} parsed only without lint,` +
            ` ${counts.rejected} not parsed, ${counts.changed} changed`,
        );

        // A child that died names the file it was in: the visit pass panics on a scope that the parse pass did not record.
        expect([normal.crash, lint.crash].filter(Boolean)).toEqual([]);
        // Each child proves its own mode: a parse without lint takes the sentinel, a lint parse rejects it.
        expect({
          normal: normal.records.get("-1:0")?.code,
          lint: lint.records.get("-1:0")?.errors ? "rejected" : lint.records.get("-1:0")?.code,
        }).toEqual({ normal: "let x;\n", lint: "rejected" });
        expect({ differences, onlyWithoutLint }).toEqual({ differences: [], onlyWithoutLint: [] });
        // Nearly every file parses: an empty or unread list would pass the comparisons above.
        expect(counts.equal + counts.rejected + counts.changed).toBe(counts.files);
        expect(counts.rejected + counts.changed).toBeLessThan(counts.files / 100);
      },
      300_000,
    );
  }
});
