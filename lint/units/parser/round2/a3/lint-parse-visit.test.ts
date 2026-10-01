import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// With debug assertions, `Parser::parse` reads BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT and then runs its parse pass as
// `Parser::parse_for_lint` does (side table, type nodes, strict grammar) before the unchanged visit pass and printer.
// What is printed must be what the normal transpile prints, for every TypeScript file under test/ and src/js.
// A release build has no such switch, so this is skipped there (also under USE_SYSTEM_BUN=1). A build with debug
// assertions and without the switch fails at the sentinel, which only a lint parse rejects.

const root = join(import.meta.dir, "..", "..", "..");
const sentinel = "let x: (a: ) => void;\n";
const shardCount = 4;

const worker = String.raw`
const fs = require("node:fs");
const [listPath, outPath] = process.argv.slice(2);
const { root, sentinel, files } = JSON.parse(fs.readFileSync(listPath, "utf8"));
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = [
  { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) },
  { ts: new Bun.Transpiler({ loader: "ts", tsconfig }), tsx: new Bun.Transpiler({ loader: "tsx", tsconfig }) },
];
const out = fs.openSync(outPath, "w");
function transform(index, config, loader, source) {
  // The line before the result names the file that a crash is in.
  fs.writeSync(out, JSON.stringify({ start: index, config }) + "\n");
  let result;
  try {
    result = { code: transpilers[config][loader].transformSync(source) };
  } catch (e) {
    result = { errors: (e?.errors ?? [e]).map(error => String(error?.message ?? error)) };
  }
  fs.writeSync(out, JSON.stringify({ index, config, ...result }) + "\n");
}
transform(-1, 0, "ts", sentinel);
for (const [index, file] of files) {
  const source = fs.readFileSync(root + "/" + file);
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  transform(index, 0, loader, source);
  // A line that starts with a decorator: once more with experimental decorators and their metadata.
  if (/^[ \t]*@[A-Za-z_$(]/m.test(source.latin1Slice())) transform(index, 1, loader, source);
}
fs.closeSync(out);
`;

type Record = { index: number; config: number; code?: string; errors?: string[] };

function lines(buffer: Buffer): Buffer[] {
  const result: Buffer[] = [];
  for (let start = 0; start < buffer.length; ) {
    const end = buffer.indexOf(10, start);
    if (end === -1) {
      result.push(buffer.subarray(start));
      break;
    }
    result.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return result;
}

describe.skipIf(!isDebug && !isASAN)("a lint parse, visited and printed", () => {
  test(
    "is the normal transpile of every TypeScript file under test/ and src/js",
    async () => {
      // The tracked files only: an installed node_modules or a stray file is no part of the claim.
      await using git = Bun.spawn({
        cmd: ["git", "-C", root, "ls-files", "-z", "--", "test", "src/js"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [listing, gitStderr, gitExitCode] = await Promise.all([git.stdout.text(), git.stderr.text(), git.exited]);
      const files = listing.split("\0").filter(file => /\.(ts|tsx|mts|cts)$/.test(file));
      expect({ files: files.length > 3000, gitStderr, gitExitCode }).toEqual({ files: true, gitStderr, gitExitCode: 0 });
      const shards: [number, string][][] = Array.from({ length: shardCount }, () => []);
      files.forEach((file, index) => shards[index % shardCount].push([index, file]));

      using dir = tempDir("lint-parse-visit", {
        "worker.js": worker,
        ...Object.fromEntries(
          shards.map((shard, i) => [`${i}.list.json`, JSON.stringify({ root, sentinel, files: shard })]),
        ),
      });

      const nameOf = (index: number, config: number) =>
        `${files[index] ?? "<sentinel>"}${config ? " (experimental decorators with metadata)" : ""}`;

      async function run(shard: number, lint: boolean) {
        const name = `${shard}.${lint ? "lint" : "normal"}`;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "worker.js", `${shard}.list.json`, `${name}.jsonl`],
          cwd: String(dir),
          env: lint ? { ...bunEnv, BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT: "1" } : bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        let records: Buffer[] = [];
        try {
          records = lines(readFileSync(join(String(dir), `${name}.jsonl`)));
        } catch {}
        const last = records.length % 2 === 1 ? JSON.parse(records[records.length - 1].toString()) : undefined;
        const crash =
          exitCode === 0 && last === undefined && records.length > 0
            ? undefined
            : {
                child: name,
                exitCode,
                signalCode: proc.signalCode,
                at: last ? nameOf(last.start, last.config) : "outside a file",
                stderr: stderr.slice(-4000),
              };
        return { records, crash };
      }

      const counts = { files: files.length, equal: 0, rejectedByBoth: 0, decorated: 0, decoratedEqual: 0 };
      const sentinels: { normal: unknown; lint: unknown }[] = [];
      const crashed: unknown[] = [];
      const differing: unknown[] = [];
      const onlyWithoutLint: unknown[] = [];
      const onlyWithLint: unknown[] = [];

      // Four children at a time: two shards, each parsed both ways.
      for (let first = 0; first < shardCount; first += 2) {
        const pair = [first, first + 1].filter(shard => shard < shardCount);
        const results = await Promise.all(pair.flatMap(shard => [run(shard, false), run(shard, true)]));
        for (let k = 0; k < results.length; k += 2) {
          const [normal, lint] = [results[k], results[k + 1]];
          if (normal.crash) crashed.push(normal.crash);
          if (lint.crash) crashed.push(lint.crash);
          for (let i = 1; i < Math.min(normal.records.length, lint.records.length); i += 2) {
            const [a, b] = [normal.records[i], lint.records[i]];
            const head = a.subarray(0, 48).toString("latin1");
            const isDecorated = head.includes('"config":1,');
            if (isDecorated) counts.decorated++;
            // The same bytes of a printed file need no parsing here: that is nearly every line.
            if (a.equals(b) && head.includes('"code":') && !head.includes('"index":-1,')) {
              if (isDecorated) counts.decoratedEqual++;
              else counts.equal++;
              continue;
            }
            const [n, l]: Record[] = [JSON.parse(a.toString()), JSON.parse(b.toString())];
            if (n.index === -1) {
              sentinels.push({ normal: n.code ?? n.errors, lint: l.code ?? l.errors });
            } else if (n.code !== undefined && l.code !== undefined) {
              let at = 0;
              while (n.code[at] === l.code[at]) at++;
              differing.push({
                file: nameOf(n.index, n.config),
                at,
                normal: n.code.slice(Math.max(0, at - 80), at + 80),
                lint: l.code.slice(Math.max(0, at - 80), at + 80),
              });
            } else if (n.code !== undefined) {
              const code = l.errors!.map(message => /^TS(\d+): /.exec(message)?.[1]).find(Boolean);
              onlyWithoutLint.push({ file: nameOf(n.index, n.config), code: code ?? "no code", errors: l.errors });
            } else if (l.code !== undefined) {
              onlyWithLint.push({ file: nameOf(n.index, n.config), errors: n.errors });
            } else if (!isDecorated) {
              counts.rejectedByBoth++;
            }
          }
        }
      }

      console.log(
        `lint parse, visited and printed: ${counts.equal} of ${counts.files} files equal` +
          ` (and ${counts.decoratedEqual} of ${counts.decorated} again with experimental decorators), ${differing.length} differing,` +
          ` ${onlyWithoutLint.length} parsed only without lint, ${onlyWithLint.length} parsed only with lint,` +
          ` ${counts.rejectedByBoth} rejected by both, ${crashed.length} crashed`,
      );

      // Each child proves its own mode: a parse without lint takes the sentinel, a lint parse reports TS1110.
      expect(sentinels).toEqual(
        Array.from({ length: shardCount }, () => ({
          normal: "let x;\n",
          lint: expect.arrayContaining(["TS1110: Type expected."]),
        })),
      );
      expect({ crashed, differing, onlyWithoutLint, onlyWithLint }).toEqual({
        crashed: [],
        differing: [],
        onlyWithoutLint: [],
        onlyWithLint: [],
      });
      // Nearly every file parses: an empty or unread list would pass the comparisons above.
      expect(counts.equal + counts.rejectedByBoth).toBe(counts.files);
      expect(counts.rejectedByBoth).toBeLessThan(counts.files / 100);
    },
    600_000,
  );
});
