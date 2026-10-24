// `bun build --compile --aot main.ts worker.ts ..`: a global begins at an entry point, the process at the first and a Worker at the one that it names. What the compiler proves holds for
// one global, so each entry point begins a program of its own: it is compiled as it is when it is built alone, and nothing that another entry point does costs it anything.
// An entry point that loads a module by a name that the build does not know may load any of the others, so its program has to hold them all. An executable holds nothing twice: the
// build has one program then, as it has where nothing starts a Worker.
import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { compileCommand, withProgramOutput } from "./harness/flags";
import { built, spawned, withoutDebugInformation } from "./run-programs";
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

// Each of them would cost the main program a direct call, a field at a fixed place or the type of an argument.
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

describe("compile/aot/entry points begin programs of their own", () => {
  const root = String(tempDir("aot-entry-points-begin-programs", {}));
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
        [
          bunExe(),
          ...compileCommand,
          ...carrier,
          "--root",
          ".",
          withProgramOutput(join(folder, name + ".ir")),
          ...entryPoints,
          "--outfile",
          join(folder, name),
        ],
        folder,
        bunEnv,
      ),
    );
    return join(folder, name);
  };
  /** The program of entry point `index`, as the front end hands it to the engine. */
  const programOf = (folder: string, name: string, index: number) =>
    readFileSync(join(folder, name + ".ir" + (index ? "." + index : "")));
  const areEqual = (a: Buffer, b: Buffer) => a.equals(b);

  test("each is compiled as it is alone, and they run as in plain Bun", async () => {
    const folder = write(join(root, "together"), files);
    const entryPoints = ["./main.ts", "./worker.ts", "./lib/second.ts", "./lib/third.ts"];
    const executable = await build(folder, entryPoints, "together");
    for (const [index, entryPoint] of entryPoints.entries()) {
      await build(folder, [entryPoint], "alone");
      expect({
        entryPoint,
        isAsAlone: areEqual(programOf(folder, "together", index), programOf(folder, "alone", 0)),
      }).toEqual({ entryPoint, isAsAlone: true });
    }
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

  test("what a worker does is nothing to the main program", async () => {
    const [loud, quiet] = [
      write(join(root, "loud"), files),
      write(join(root, "quiet"), { ...files, "worker.ts": quietWorker }),
    ];
    for (const folder of [loud, quiet]) await build(folder, ["./main.ts", "./worker.ts"], "program");
    expect(areEqual(programOf(loud, "program", 0), programOf(quiet, "program", 0))).toBe(true);
    expect(areEqual(programOf(loud, "program", 1), programOf(quiet, "program", 1))).toBe(false);
  }, 600_000);

  test("an entry point that loads by a name nobody knows finds the others", async () => {
    const folder = write(join(root, "by-name"), files);
    const executable = await build(folder, ["./starter-of-workers.ts", "./lib/third.ts"], "by-name");
    expect(existsSync(join(folder, "by-name.ir.1"))).toBe(false);
    const ran = await spawned([executable], root, { ...bunEnv, NAME_OF_MODULE: "./lib/third.ts" });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: "loaded by a name: third is in the main thread\nthird began a global\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);

  // The host loads what `preload` names into the global of the Worker, so there the entry points meet. No other option does that.
  test("only the option preload brings entry points together", async () => {
    const withOptions = (options: string) =>
      `const worker = new Worker("./worker.ts", ${options});\nworker.onmessage = event => {\n  console.log(event.data);\n  worker.terminate();\n};\n`;
    const folder = write(join(root, "options"), {
      ...files,
      "worker.ts": quietWorker,
      "named.ts": withOptions(`{ name: "quiet", env: { A: "1" } }`),
      "preloads.ts": withOptions(`{ preload: ["./lib/third.ts"] }`),
    });
    await build(folder, ["./worker.ts"], "alone");
    const alone = programOf(folder, "alone", 0);
    // The module that is loaded first is the first to send a message.
    for (const [main, isAsAlone, stdout] of [
      ["./named.ts", true, "quiet\n"],
      ["./preloads.ts", false, "third began a global\n"],
    ] as const) {
      const executable = await build(folder, [main, "./worker.ts", "./lib/third.ts"], "with-options");
      const hasProgramOfItsOwn = existsSync(join(folder, "with-options.ir.1"));
      expect({ main, isAsAlone: hasProgramOfItsOwn && areEqual(programOf(folder, "with-options", 1), alone) }).toEqual({
        main,
        isAsAlone,
      });
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

  // The files of all programs are read and checked once. Each program is still what it is when it is built alone.
  const expectEachAsAlone = async (folder: string, entryPoints: string[]) => {
    await build(folder, entryPoints, "together");
    for (const [index, entryPoint] of entryPoints.entries()) {
      await build(folder, [entryPoint], "alone");
      expect({
        entryPoint,
        isAsAlone: areEqual(programOf(folder, "together", index), programOf(folder, "alone", 0)),
      }).toEqual({ entryPoint, isAsAlone: true });
    }
  };
  const startsWorkers = (...names: string[]) =>
    names.map(name => `new Worker(${JSON.stringify(name)}).onmessage = event => console.log(event.data);\n`).join("");

  test("a package whose types do not check loses them in every program that holds it", async () => {
    const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", type: "module", main: "./index.ts" });
    const uses = `import { Pair, wrong } from "walked";\nimport { Box, depth, grow } from "symbol";\nimport { Span, middle } from "returned";\n`;
    const values = `[new Pair(1, 2).sum(), wrong(new Pair(3, 4)), grow(new Box(1, 2)).area(), depth, middle(new Span(1, 5))].join(" ")`;
    const folder = write(join(root, "packages"), {
      "node_modules/walked/package.json": manifest("walked"),
      "node_modules/walked/index.ts": `export class Pair {\n  constructor(public a: number, public b: number) {}\n  sum(): number {\n    return this.a + this.b;\n  }\n}\nexport function wrong(pair: Pair): number {\n  const text: string = pair.a;\n  return (text as any) + 1;\n}\n`,
      "node_modules/symbol/package.json": manifest("symbol"),
      "node_modules/symbol/index.ts": `export class Box {\n  constructor(public width: number, public height: number) {}\n  area(): number {\n    return this.width * this.height;\n  }\n}\nconst first = new Box(2, 3);\nexport const depth = first.depth;\nexport function grow(box: Box): Box {\n  return new Box(box.width + 1, box.height + 1);\n}\n`,
      "node_modules/returned/package.json": manifest("returned"),
      "node_modules/returned/index.ts": `export class Span {\n  constructor(public from: number, public to: number) {}\n}\nexport function middle(span: Span) {\n  return span.center + (span.from + span.to) / 2;\n}\n`,
      "main.ts": `${uses}${startsWorkers("./worker.ts", "./other.ts")}console.log(${values});\n`,
      "worker.ts": `${uses}postMessage(${values});\n`,
      "other.ts": `import { Span, middle } from "returned";\npostMessage(middle(new Span(10, 50)));\n`,
    });
    await expectEachAsAlone(folder, ["./main.ts", "./worker.ts", "./other.ts"]);
  }, 600_000);

  test("each is configured by the tsconfig.json that its entry point finds", async () => {
    const options = { target: "esnext", module: "esnext", moduleResolution: "bundler" };
    const folder = write(join(root, "configured"), {
      "app/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, strict: true } }),
      "app/main.ts": `class Holder {\n  first: number | undefined;\n  second = 2;\n}\n${startsWorkers("./work/worker.ts")}console.log(Object.keys(new Holder()).join());\n`,
      "work/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, strict: false, useDefineForClassFields: false },
      }),
      "work/worker.ts": `class Holder {\n  first: number;\n  second = 2;\n}\nfunction length(text: string) {\n  return text === null ? -1 : text.length;\n}\npostMessage(Object.keys(new Holder()).join() + " " + length(null));\n`,
    });
    await expectEachAsAlone(folder, ["./app/main.ts", "./work/worker.ts"]);
  }, 600_000);

  test("what one program declares for every file is nothing to the others", async () => {
    const folder = write(join(root, "declared"), {
      "shared.ts": shared,
      "globals.ts": `declare global {\n  interface Number {\n    twice(): number;\n  }\n  var counted: number;\n}\nexport const name = "globals";\n`,
      "main.ts": `import { name } from "./globals.ts";\nimport { Point } from "./shared.ts";\n${startsWorkers("./worker.ts", "./second.ts")}console.log(name, typeof globalThis.counted, new Point(3, 4).length());\n`,
      "worker.ts": `import { Point } from "./shared.ts";\npostMessage(new Point(6, 8).length());\n`,
      "second.ts": `import { Point } from "./shared.ts";\npostMessage(new Point(9, 12).length());\n`,
    });
    await expectEachAsAlone(folder, ["./main.ts", "./worker.ts", "./second.ts"]);
  }, 600_000);

  test("the order in which another program imports the files is nothing to a program", async () => {
    const folder = write(join(root, "ordered"), {
      "a.ts": `export class First {\n  constructor(public value: number) {}\n  twice(): number {\n    return this.value * 2;\n  }\n}\n`,
      "b.ts": `export class Second {\n  constructor(public value: number) {}\n  half(): number {\n    return this.value / 2;\n  }\n}\n`,
      "main.ts": `import { Second } from "./b.ts";\nimport { First } from "./a.ts";\n${startsWorkers("./worker.ts")}console.log(new First(2).twice(), new Second(2).half());\n`,
      "worker.ts": `import { First } from "./a.ts";\nimport { Second } from "./b.ts";\npostMessage(new First(4).twice() + new Second(4).half());\n`,
    });
    await expectEachAsAlone(folder, ["./main.ts", "./worker.ts"]);
  }, 600_000);

  // A file is compiled once for each program that holds it.
  test("entry points that share most of their files are one program", async () => {
    const functions = Array.from(
      { length: 6000 },
      (_, i) => `export function add${i}(value: number): number {\n  return value + ${i};\n}\n`,
    );
    const uses = `import * as large from "./large.ts";\n`;
    const folder = write(join(root, "shared-files"), {
      "large.ts": functions.join(""),
      "main.ts": `${uses}${startsWorkers("./worker.ts")}console.log(large.add1(1));\n`,
      "worker.ts": `${uses}postMessage(large.add2(2));\n`,
    });
    const executable = await build(folder, ["./main.ts", "./worker.ts"], "shared-files");
    expect(existsSync(join(folder, "shared-files.ir.1"))).toBe(false);
    const ran = await spawned([executable], root, bunEnv);
    expect({ stdout: ran.stdout, stderr: ran.stderr, signal: ran.signal }).toEqual({
      stdout: "2\n4\n",
      stderr: "",
      signal: null,
    });
  }, 600_000);

  // Pages and plugins are further entry points by the hundred, and all of them are loaded into the one global.
  test("where nothing starts a Worker the entry points are one program", async () => {
    const folder = write(join(root, "one-program"), files);
    const executable = await build(folder, ["./starter.ts", "./lib/third.ts"], "one-program");
    expect(existsSync(join(folder, "one-program.ir.1"))).toBe(false);
    const ran = await spawned([executable], root, { ...bunEnv, NAME_OF_MODULE: "./lib/third.ts" });
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stdout: "loaded by a name: third is in the main thread\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  }, 600_000);
});
