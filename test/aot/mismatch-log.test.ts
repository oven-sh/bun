// The lines an executable writes about itself at run time: a value that fails a written type. docs/bundler/aot-debugging.mdx describes
// the two formats, the counts and the two environment variables.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
  },
});

// The program of docs/bundler/aot-debugging.mdx.
const visits = `function double(n: number): number {
  return n * 2;
}

const body: any = JSON.parse('{"visits":"3"}');
console.log(double(body.visits));
console.log((body.visits as number) + 1);
`;
const visitsOutput = "6\n31\n";

const overflowLine = "[aot] type-mismatch log is full (200 sites). New sites are not logged";
const linePattern = /^\[aot\] type-mismatch ([0-9a-f]{12}) ([a-z0-9-]+) (\S+):(\d+):(\d+) \((.*?)\): (.*)$/;
const membersInOrder = ["aot", "id", "kind", "file", "line", "col", "fn", "expected", "got", "action", "count"];

interface Line {
  id: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  function: string;
  expected?: string;
  got?: string;
  action?: string;
  count: string;
  callers: string[];
  text: string;
}

function lines(text: string): Line[] {
  const found: Line[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("[aot] type-mismatch ") || line === overflowLine) continue;
    expect(line).toMatch(linePattern);
    const [, id, kind, file, lineNumber, column, functionName, rest] = linePattern.exec(line)!;
    const parts = rest.split("; ");
    const types = /^expected (.*), got (.*)$/.exec(parts[0]);
    found.push({
      id,
      kind,
      file,
      line: Number(lineNumber),
      column: Number(column),
      function: functionName,
      expected: types?.[1],
      got: types?.[2],
      action: parts.find(part => part === "continued"),
      count: /; count (\d+)/.exec(line)![1] + (line.endsWith("; total") ? "; total" : ""),
      callers:
        parts
          .find(part => part.startsWith("from "))
          ?.slice("from ".length)
          .split(" < ") ?? [],
      text: line,
    });
  }
  return found;
}

async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1", ...env });
  return { stdout, stderr, exitCode };
}

const project = (source: string) =>
  tempDir("aot-mismatch-log", {
    "tsconfig.json": tsconfig,
    "package.json": `{ "name": "app", "type": "module" }`,
    "app.ts": source,
  });

async function build(dir: string, ...flags: string[]) {
  const { stderr, exitCode } = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "app.ts", "--outfile", "app"],
    dir,
  );
  expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
}

const run = (dir: string, env: Record<string, string> = {}) =>
  spawned([join(dir, isWindows ? "app.exe" : "app")], dir, env);

test.concurrent(
  "a log build writes a line for each mismatch and prints what bun run prints",
  async () => {
    using dir = project(visits);
    await build(String(dir), "--aot-log-type-mismatches");
    expect(await spawned([bunExe(), "run", "app.ts"], String(dir))).toEqual({
      stdout: visitsOutput,
      stderr: "",
      exitCode: 0,
    });

    const { stdout, stderr, exitCode } = await run(String(dir));
    const found = lines(stderr);
    expect(found).toContainEqual(
      expect.objectContaining({
        kind: "argument",
        file: "app.ts",
        expected: expect.stringMatching(/^number\b/),
        got: "string",
      }),
    );
    expect(found).toContainEqual(
      expect.objectContaining({ kind: "cast", file: "app.ts", line: 7, function: "module" }),
    );
    expect(new Set(found.map(line => line.action))).toEqual(new Set(["continued"]));
    expect({ stdout, exitCode }).toEqual({ stdout: visitsOutput, exitCode: 0 });
  },
  120_000,
);

test.concurrent(
  "a site writes its 1st and 10th failure and a total at exit, and never a value",
  async () => {
    using dir = project(
      `function take(n: number) { return n; }\nconst inputs: any[] = JSON.parse('["hunter2"]');\nfor (let i = 0; i < 12; i++) take(inputs[0]);\n`,
    );
    await build(String(dir), "--aot-log-type-mismatches");

    const { stderr, exitCode } = await run(String(dir));
    const countsById = Map.groupBy(lines(stderr), line => line.id);
    expect(countsById.size).toBeGreaterThan(0);
    for (const sameSite of countsById.values())
      expect(sameSite.map(line => line.count)).toEqual(["1", "10", "12; total"]);
    expect(stderr).not.toContain("hunter2");
    expect(exitCode).toBe(0);
  },
  120_000,
);

test.concurrent(
  "a site counts eight kinds of value by name and the rest as other, and a line names its callers",
  async () => {
    using dir = project(`function take(n: number) {
  return n;
}
function forward(value: any) {
  const taken = take(value); return taken;
}
const values: any[] = [true, "text", () => 1, Symbol(), 1n, [], new Map(), new Set(), new Date(0), /x/];
for (const value of values) forward(value);
console.log("done");
`);
    await build(String(dir), "--aot-log-type-mismatches");

    const { stdout, stderr, exitCode } = await run(String(dir));
    const found = lines(stderr);
    const linesById = Map.groupBy(found, line => line.id);
    expect(linesById.size).toBeGreaterThan(0);
    for (const sameSite of linesById.values()) {
      const named = sameSite.slice(0, 8);
      expect(named.slice(0, 5).map(line => line.got)).toEqual(["boolean", "string", "function", "symbol", "bigint"]);
      expect(new Set(named.map(line => line.got)).size).toBe(8);
      expect(named.map(line => line.got)).not.toContain("other");
      expect(named.map(line => line.count)).toEqual(Array(8).fill("1"));
      expect(sameSite.slice(8).map(line => `${line.got}; count ${line.count}`)).toEqual([
        "other; count 1",
        "other; count 2; total",
      ]);

      const callers = sameSite[0].function === "take" ? ["app.ts:5", "app.ts:8"] : ["app.ts:8"];
      expect(sameSite.map(line => line.callers)).toEqual([...Array(9).fill(callers), []]);
    }
    expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });

    const json = await run(String(dir), { BUN_AOT_TYPE_MISMATCH_LOG_FORMAT: "json" });
    const records = json.stderr
      .trimEnd()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(records.map(record => record.from ?? [])).toEqual(found.map(line => line.callers));
    expect(records.map(record => Object.keys(record).slice(membersInOrder.length))).toEqual(
      found.map(line => (line.callers.length ? ["from"] : ["total"])),
    );
  },
  120_000,
);

test.concurrent(
  "BUN_AOT_TYPE_MISMATCH_LOG names the destination, BUN_AOT_TYPE_MISMATCH_LOG_FORMAT the format",
  async () => {
    using dir = project(visits);
    await build(String(dir), "--aot-log-type-mismatches");
    const parse = (text: string) =>
      text
        .trimEnd()
        .split("\n")
        .map(line => JSON.parse(line));

    const log = join(String(dir), "mismatches.jsonl");
    expect(await run(String(dir), { BUN_AOT_TYPE_MISMATCH_LOG: log })).toEqual({
      stdout: visitsOutput,
      stderr: "",
      exitCode: 0,
    });
    const records = parse(readFileSync(log, "utf8"));
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(Object.keys(record).slice(0, membersInOrder.length)).toEqual(membersInOrder);
      expect({ ...record }).toMatchObject({
        aot: "type-mismatch",
        id: expect.stringMatching(/^[0-9a-f]{12}$/),
        file: "app.ts",
        line: expect.any(Number),
        col: expect.any(Number),
        got: "string",
        action: "continued",
        count: 1,
      });
    }

    const jsonOnStderr = await run(String(dir), { BUN_AOT_TYPE_MISMATCH_LOG_FORMAT: "json" });
    expect(parse(jsonOnStderr.stderr)).toEqual(records);
    expect(jsonOnStderr.stdout).toBe(visitsOutput);

    const textLog = join(String(dir), "mismatches.txt");
    expect(
      (await run(String(dir), { BUN_AOT_TYPE_MISMATCH_LOG: textLog, BUN_AOT_TYPE_MISMATCH_LOG_FORMAT: "text" })).stderr,
    ).toBe("");
    expect(lines(readFileSync(textLog, "utf8")).map(line => line.id)).toEqual(records.map(record => record.id));

    expect(await run(String(dir), { BUN_AOT_TYPE_MISMATCH_LOG: "off" })).toEqual({
      stdout: visitsOutput,
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

test.concurrent(
  "the log records 200 sites, says once that it is full, and the program goes on",
  async () => {
    const declarations = Array.from(
      { length: 205 },
      (_, index) =>
        `const raw${index}: any = JSON.parse('"text"'); const v${index}: number = raw${index}; kept.push(v${index});`,
    );
    using dir = project(
      `const kept: unknown[] = [];\n${declarations.join("\n")}\nconsole.log(kept.length === 205 ? "done" : "lost");\n`,
    );
    await build(String(dir), "--aot-log-type-mismatches");

    const { stdout, stderr, exitCode } = await run(String(dir));
    expect(new Set(lines(stderr).map(line => line.id)).size).toBe(200);
    expect(stderr.split("\n").filter(line => line === overflowLine)).toHaveLength(1);
    expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });
  },
  120_000,
);

test.concurrent(
  "a class of the program that fails a type is reported by its name, every other callable as a function",
  async () => {
    using dir = project(`declare const process: any;
class Box {
  value = 1;
}
function named() {}
function take(n: number) {
  return n;
}
const values: any[] = [Box, named, class {}, () => 1, Map, process.getBuiltinModule("node:async_hooks").AsyncLocalStorage];
for (const value of values) take(value);
console.log("done");
`);
    await build(String(dir), "--aot-log-type-mismatches");

    const { stdout, stderr, exitCode } = await run(String(dir));
    const linesById = Map.groupBy(lines(stderr), line => line.id);
    expect(linesById.size).toBeGreaterThan(0);
    for (const sameSite of linesById.values())
      expect(sameSite.map(line => `${line.got}; count ${line.count}`)).toEqual([
        "class Box; count 1",
        "function; count 1",
        "class; count 1",
        "function; count 4; total",
      ]);
    expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });
  },
  120_000,
);

test.concurrent(
  "a log build of a program that respects its types writes nothing",
  async () => {
    using dir = project(
      `function double(n: number): number {\n  return n * 2;\n}\n\nconst body: { visits: number } = JSON.parse('{"visits":3}');\nconsole.log(double(body.visits));\n`,
    );
    await build(String(dir), "--aot-log-type-mismatches");
    expect(await run(String(dir))).toEqual({ stdout: "6\n", stderr: "", exitCode: 0 });
  },
  120_000,
);

test.concurrent(
  "the default build goes on as well, and writes nothing",
  async () => {
    using dir = project(visits);
    await build(String(dir));
    for (const env of [{}, { BUN_AOT_TYPE_MISMATCH_LOG_FORMAT: "json" }, { BUN_AOT_TYPE_MISMATCH_LOG: "stderr" }]) {
      expect({ env, ...(await run(String(dir), env)) }).toEqual({ env, stdout: visitsOutput, stderr: "", exitCode: 0 });
    }
  },
  120_000,
);
