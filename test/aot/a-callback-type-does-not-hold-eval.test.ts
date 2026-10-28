// A position with a function type holds the functions that the program converts to that type. A value from outside that passes
// the position's test is one of them. It is not `eval`, `Function` or `require`: those open a program only where a call that
// can be reached really gets them.
//
// Bun's own library has hundreds of callbacks with function types, so a program that only loads node:stream must stay closed.
// The other way round: a program that does hand `eval` to such a position behaves as it does in plain Bun, and the build lists
// the evaluator. An ordinary built-in function in a callback's place works and opens nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport, type BuildReport } from "./harness/build-report";
import { compileCommand, withReport } from "./harness/flags";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  },
});

// The folder has Bun's types and not Node's.
const declarations = `declare var process: { argv: string[]; nextTick(callback: (...args: any[]) => void, ...args: unknown[]): void };
declare var Buffer: { from(text: string): Uint8Array };
declare module "node:net" {}
declare module "node:stream" {
  export class Writable {
    constructor(options: { write(chunk: Uint8Array, encoding: string, done: () => void): void });
    on(name: string, listener: () => void): this;
  }
  export class Readable {
    static from(items: Iterable<unknown>): Readable;
    pipe<T>(destination: T): T;
  }
}
declare module "node:events" {
  export class EventEmitter {
    on(name: string, listener: (...args: any[]) => void): this;
    emit(name: string, ...args: unknown[]): boolean;
  }
}
declare module "node:module" {
  const Module: { prototype: any; createRequire(from: string): (name: string) => any };
  export default Module;
}
`;

async function compileAndRun(text: string): Promise<{ report: BuildReport; stdout: string }> {
  using dir = tempDir("aot-a-callback-type-does-not-hold-eval", {
    "main.ts": text,
    "node.d.ts": declarations,
    "tsconfig.json": tsconfig,
  });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const reportPath = join(folder, "report.json");
  built(
    await spawned(
      [bunExe(), ...compileCommand, ...withReport(reportPath, "summary"), "main.ts", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const ran = await spawned([executable], folder, bunEnv);
  expect({ signal: ran.signal, exitCode: ran.exitCode, stderr: ran.stderr }).toEqual({
    signal: null,
    exitCode: 0,
    stderr: "",
  });
  return { report: readBuildReport(reportPath), stdout: ran.stdout };
}

const closed: Record<string, { text: string; output: string }> = {
  "node:stream is loaded": {
    text: `import "node:stream";\nconsole.log(1);\n`,
    output: "1\n",
  },
  "node:net is loaded": {
    text: `import "node:net";\nconsole.log(1);\n`,
    output: "1\n",
  },
  "a stream is piped": {
    text: `import { Readable, Writable } from "node:stream";
let bytes = 0;
const sink = new Writable({
  write(chunk, _encoding, done) {
    bytes += chunk.length;
    done();
  },
});
sink.on("finish", () => console.log(bytes));
Readable.from([Buffer.from("ab"), Buffer.from("cde")]).pipe(sink);
`,
    output: "5\n",
  },
  "Math.max stands where a callback is expected": {
    text: `type Pick = (a: number, b: number) => number;
function apply(pick: Pick): number {
  return pick(1, 2);
}
const chosen: Pick = process.argv.length > 99 ? (a, b) => a - b : Math.max;
console.log(apply(chosen));
`,
    output: "2\n",
  },
};

const open: Record<string, { text: string; output: string; record?: Record<string, string> }> = {
  "eval stands where a callback of the program is expected": {
    text: `type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const chosen: Callback = process.argv.length > 99 ? text => text.length : eval;
console.log(run(chosen, process.argv.length > 99 ? "0" : "1 + 2"));
`,
    output: "3\n",
  },
  "eval comes through any to a callback of the program": {
    text: `type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const loose: any = process.argv.length > 99 ? (text: string) => text.length : eval;
console.log(run(loose, process.argv.length > 99 ? "0" : "1 + 2"));
`,
    output: "3\n",
  },
  "eval is a listener of an EventEmitter": {
    text: `import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("text", eval);
emitter.emit("text", process.argv.length > 99 ? "0" : "globalThis.ranTheString = true");
console.log((globalThis as any).ranTheString);
`,
    output: "true\n",
  },
  "eval is handed to process.nextTick": {
    text: `process.nextTick(eval, process.argv.length > 99 ? "0" : "globalThis.ranTheString = true");
setTimeout(() => console.log((globalThis as any).ranTheString), 1);
`,
    output: "true\n",
  },
};

// The analysis takes a store under one of these names through a receiver it has lost for a store into the module loader
// (`Module.wrap = ..`, `module.require = ..`), but not in Bun's own library, which stores under them only into objects it has
// made itself. Whoever adds such a store to src/js looks at its receiver first, and then adds it here.
const namesOfLoaderLocations = ["wrap", "wrapper", "require", "cache", "_cache", "_load", "_resolveFilename"];
const storesOfTheLibrary = [
  "eval/fuzzilli-reprl.ts: globalThis.require =",
  "eval/node-repl.ts: global_.require =",
  "internal/streams/readable.ts: Readable.prototype.wrap =",
  "internal/streams/readable.ts: Readable.wrap =",
];

test("the library stores under a name of the module loader only into its own objects", () => {
  const root = join(import.meta.dir, "../../src/js");
  const store = new RegExp(String.raw`[\w$.\]\[]+\.(?:${namesOfLoaderLocations.join("|")})\s*=(?!=)`, "g");
  const found = new Set<string>();
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.[jt]s$/.test(file) || file.endsWith(".d.ts") || file.includes("node_modules")) continue;
    const name = file.replaceAll("\\", "/");
    for (const [text] of readFileSync(join(root, file), "utf8").matchAll(store))
      found.add(`${name}: ${text.replace(/\s*=$/, " =")}`);
  }
  expect([...found].sort()).toEqual(storesOfTheLibrary);
});

describe.concurrent("compile/aot/a callback type does not hold eval", () => {
  for (const [name, { text, output }] of Object.entries(closed)) {
    test(
      name,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text);
          expect({ stdout, unseenCode: report.unseenCode }).toEqual({ stdout: output, unseenCode: [] });
        }),
      600_000,
    );
  }

  for (const [name, { text, output, record }] of Object.entries(open)) {
    test(
      name,
      () =>
        slot(async () => {
          const { report, stdout } = await compileAndRun(text);
          expect(stdout).toBe(output);
          expect(report.unseenCode).toContainEqual(
            expect.objectContaining(record ?? { cause: "EvaluatesText", builtin: "eval" }),
          );
        }),
      600_000,
    );
  }
});
