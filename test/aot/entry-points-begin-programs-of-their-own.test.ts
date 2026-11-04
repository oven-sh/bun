// `bun build --compile --aot main.ts worker.ts ..`: a global begins at an entry point, the process at the first and a Worker at the one that it names. All of them are compiled as one
// program, and each global has its own instances of the modules: what one global does to a class, a function or a list that the files share is nothing to the others.
import { expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

const shared = `export class Point {
  constructor(public x: number, public y: number) {}
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}
export function describe(value: any): string {
  return "<" + value.x + ">";
}
export const started: string[] = [];
`;

const main = `import { Point, describe, started } from "./shared.ts";
function lengths(points: Point[]): number {
  let sum = 0;
  for (const point of points) sum += point.length();
  return sum;
}
started.push("main");
const points = [new Point(3, 4), new Point(6, 8)];
const answerOf = (name: string) =>
  new Promise<string>(resolve => {
    const worker = new Worker(name);
    worker.onmessage = event => {
      resolve(event.data);
      worker.terminate();
    };
  });
console.log("main", lengths(points), describe(points[0]), started.join());
for (const name of ["./worker.ts", "./lib/second.ts", "./worker.ts"]) console.log(name, await answerOf(name));
console.log(await Promise.all(["./worker.ts", "./lib/second.ts", "./lib/second.ts", "./worker.ts"].map(answerOf)));
console.log("main", lengths(points), describe(points[0]), started.join());
`;

// None of it holds in the main global: there the method is the one of the class, `describe` gets a Point, and `started` is another list.
const worker = `import { Point, describe, started } from "./shared.ts";
started.push("worker");
Point.prototype.length = function () {
  return -1;
};
postMessage([new Point(1, 0).length(), describe({ y: 1, x: "text" }), started.join()].join(" "));
`;

const quietWorker = `postMessage("quiet");
`;

// A Worker starts a Worker, and imports another entry point by a constant: in this global that one is an ordinary module.
const second = `import { Point, started } from "../shared.ts";
started.push("second");
const inner = new Worker("./lib/third.ts");
inner.onmessage = async event => {
  inner.terminate();
  const { name } = await import("./third.ts");
  postMessage([new Point(3, 4).length(), event.data, name, started.join()].join(" "));
};
`;

const third = `import { started } from "../shared.ts";
started.push("third");
export const name = "third is " + (Bun.isMainThread ? "in the main thread" : "in a worker");
if (!Bun.isMainThread && started.length === 1) postMessage("third began a global");
`;

const starter = `const { name } = await import(process.env.NAME_OF_MODULE!);
console.log("loaded by a name:", name);
`;

const starterOfWorkers = `${starter}const worker = new Worker("./lib/third.ts");
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
`;

// Each test has a folder of its own.
describe.concurrent("compile/aot/a global begins at each entry point", () => {
  const root = String(tempDir("aot-entry-points", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const carrier = withoutDebugInformation();

  function write(folder: string, files: Record<string, string>) {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, name)), { recursive: true });
      writeFileSync(join(folder, name), text);
    }
    return folder;
  }
  const files = {
    "shared.ts": shared,
    "main.ts": main,
    "worker.ts": worker,
    "lib/second.ts": second,
    "lib/third.ts": third,
    "starter.ts": starter,
    "starter-of-workers.ts": starterOfWorkers,
  };
  const build = async (folder: string, entryPoints: string[], name: string) => {
    built(
      await spawned(
        [bunExe(), ...compileCommand, ...carrier, "--root", ".", ...entryPoints, "--outfile", join(folder, name)],
        folder,
        bunEnv,
      ),
    );
    return join(folder, name);
  };

  test("they run as in plain Bun", async () => {
    const folder = write(join(root, "together"), files);
    const entryPoints = ["./main.ts", "./worker.ts", "./lib/second.ts", "./lib/third.ts"];
    const executable = await build(folder, entryPoints, "together");
    const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
    expect({ exitCode: plain.exitCode, signal: plain.signal, stderr: plain.stderr }).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
    const ran = await spawned([executable], root, bunEnv);
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);

  test("an entry point that loads by a name nobody knows finds the others", async () => {
    const folder = write(join(root, "by-name"), files);
    const executable = await build(folder, ["./starter-of-workers.ts", "./lib/third.ts"], "by-name");
    const ran = await spawned([executable], root, { ...bunEnv, NAME_OF_MODULE: "./lib/third.ts" });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: "loaded by a name: third is in the main thread\nthird began a global\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);

  test("each runs the compiled code of the WebAssembly modules that it imports", async () => {
    // (module (memory <pages>)
    //   (func (export "load") (param i32) (result i32) local.get 0 i32.load)
    //   (func (export "divide") (param i32 i32) (result i32) local.get 0 local.get 1 i32.div_s))
    // prettier-ignore
    const moduleWithMemory = (pages: number) => new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x0c, 0x02, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
      0x03, 0x03, 0x02, 0x00, 0x01,
      0x05, 0x03, 0x01, 0x00, pages,
      0x07, 0x11, 0x02, 0x04, 0x6c, 0x6f, 0x61, 0x64, 0x00, 0x00, 0x06, 0x64, 0x69, 0x76, 0x69, 0x64, 0x65, 0x00, 0x01,
      0x0a, 0x11, 0x02, 0x07, 0x00, 0x20, 0x00, 0x28, 0x02, 0x00, 0x0b, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6d, 0x0b,
    ]);
    const declaresFiles = `declare module "*.wasm" {\n  const path: string;\n  export default path;\n}\n`;
    const tryTraps = `type Exports = { load(at: number): number; divide(a: number, b: number): number };
export async function tryTraps(where: string, path: string): Promise<string[]> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const { load, divide } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as Exports;
  const outcomeOf = (run: () => number) => {
    try {
      return String(run());
    } catch (error) {
      const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
      return kind + ": " + (error as Error).message.split(" (evaluating")[0];
    }
  };
  return [
    () => load(16),
    () => load(70000),
    () => load(200000),
    () => load(-4),
    () => divide(12, 4),
    () => divide(12, 0),
    () => divide(-2147483648, -1),
  ].map((run, index) => where + " " + index + ": " + outcomeOf(run));
}
`;
    const importsModule = (file: string) =>
      `/// <reference path="./wasm-files.d.ts" />\nimport path from "./${file}";\nimport { tryTraps } from "./try-traps.ts";\n`;
    const folder = write(join(root, "webassembly"), {
      "wasm-files.d.ts": declaresFiles,
      "try-traps.ts": tryTraps,
      "main.ts": `${importsModule("one-page.wasm")}console.log((await tryTraps("before", path)).join("\\n"));
const worker = new Worker("./worker.ts");
worker.onmessage = async event => {
  console.log(event.data.join("\\n"));
  console.log((await tryTraps("after", path)).join("\\n"));
  worker.terminate();
};
`,
      "worker.ts": `${importsModule("two-pages.wasm")}postMessage(await tryTraps("worker", path));\n`,
    });
    writeFileSync(join(folder, "one-page.wasm"), moduleWithMemory(1));
    writeFileSync(join(folder, "two-pages.wasm"), moduleWithMemory(2));
    const executable = await build(folder, ["./main.ts", "./worker.ts"], "webassembly");
    const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
    expect(plain.stdout).toContain("worker 1: 0\nworker 2: WebAssembly.RuntimeError: Out of bounds memory access\n");
    const ran = await spawned([executable], root, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);

  // The host loads what `preload` names into the global of the Worker. No other option loads an entry point.
  test("what the option preload names is loaded into the global of the Worker first", async () => {
    const withOptions = (options: string) =>
      `const worker = new Worker("./worker.ts", ${options});\nworker.onmessage = event => {\n  console.log(event.data);\n  worker.terminate();\n};\n`;
    const folder = write(join(root, "options"), {
      ...files,
      "worker.ts": quietWorker,
      "named.ts": withOptions(`{ name: "quiet", env: { A: "1" } }`),
      "preloads.ts": withOptions(`{ preload: ["./lib/third.ts"] }`),
    });
    // The module that is loaded first is the first to send a message.
    for (const [main, stdout] of [
      ["./named.ts", "quiet\n"],
      ["./preloads.ts", "third began a global\n"],
    ] as const) {
      const executable = await build(folder, [main, "./worker.ts", "./lib/third.ts"], "with-options");
      const ran = await spawned([executable], root, bunEnv);
      expect({ main, stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        main,
        stdout,
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    }
  }, 600_000);

  test("each is configured by the tsconfig.json that its entry point finds", async () => {
    const options = { target: "esnext", module: "esnext", moduleResolution: "bundler" };
    const folder = write(join(root, "configured"), {
      "app/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, strict: true } }),
      "app/main.ts": `class Holder {\n  first: number | undefined;\n  second = 2;\n}\nnew Worker("./work/worker.ts").onmessage = event => console.log(event.data);\nconsole.log(Object.keys(new Holder()).join());\n`,
      "work/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, strict: false, useDefineForClassFields: false },
      }),
      "work/worker.ts": `class Holder {\n  first: number;\n  second = 2;\n}\nfunction length(text: string) {\n  return text === null ? -1 : text.length;\n}\npostMessage(Object.keys(new Holder()).join() + " " + length(null));\n`,
    });
    const executable = await build(folder, ["./app/main.ts", "./work/worker.ts"], "configured");
    const plain = await spawned([bunExe(), "run", "app/main.ts"], folder, bunEnv);
    expect({ exitCode: plain.exitCode, signal: plain.signal, stderr: plain.stderr }).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
    });
    const ran = await spawned([executable], root, bunEnv);
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);

  test("a large namespace that two entry points import answers in each global", async () => {
    const functions = Array.from(
      { length: 6000 },
      (_, i) => `export function add${i}(value: number): number {\n  return value + ${i};\n}\n`,
    );
    const uses = `import * as large from "./large.ts";\n`;
    const folder = write(join(root, "shared-files"), {
      "large.ts": functions.join(""),
      "main.ts": `${uses}new Worker("./worker.ts").onmessage = event => console.log(event.data);\nconsole.log(large.add1(1));\n`,
      "worker.ts": `${uses}postMessage(large.add2(2));\n`,
    });
    const executable = await build(folder, ["./main.ts", "./worker.ts"], "shared-files");
    const ran = await spawned([executable], root, bunEnv);
    expect({ stdout: ran.stdout, stderr: ran.stderr, signal: ran.signal }).toEqual({
      stdout: "2\n4\n",
      stderr: "",
      signal: null,
    });
  }, 600_000);

  // Pages and plugins are further entry points by the hundred, and all of them are loaded into the one global.
  test("where nothing starts a Worker an entry point is loaded by its name", async () => {
    const folder = write(join(root, "one-global"), files);
    const executable = await build(folder, ["./starter.ts", "./lib/third.ts"], "one-global");
    const ran = await spawned([executable], root, { ...bunEnv, NAME_OF_MODULE: "./lib/third.ts" });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: "loaded by a name: third is in the main thread\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);
});
