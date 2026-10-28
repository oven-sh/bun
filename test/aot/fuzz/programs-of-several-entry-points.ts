// Programs of several entry points in one executable: the first starts Workers at the others and loads pages among them by name. Each is run by plain Bun and as an executable, and both have to print the same.
//
//   bun programs-of-several-entry-points.ts --bun <bun> --work <folder> --out <folder> [--seconds 300] [--jobs 8] [--seed 1] [--flags "<flags of the build>"] [--print <seed>]
//
//   the files     main.ts; one to nine Workers; up to two pages; shared.ts, which all of them may import: a class, a counter, a table
//   in common     modules that each program imports in an order of its own and that record the order; a page that a Worker also imports by a written name; a text of 300 KB that several programs hold
//   apart         Workers in a folder with a tsconfig.json of its own, where one name leads to another file with other types; a file that one Worker alone imports and that declares globals and adds to a shared class
//   a Worker      the global Worker or that of node:worker_threads; named by a text, a URL or the text of a URL
//   in its global it changes what it shares with nobody: the counter, the table, the prototype of the shared class, a name on globalThis. Nobody else may see that
//   what crosses  numbers, texts, big integers, dates, patterns, maps, sets, buffers (copied or handed over), errors, lists with holes, objects that hold themselves, instances of the shared class, records that fit
//                 the type the receiver declares and records that do not; functions and symbols, which are refused
//   its end       terminate(), process.exit() with a code, an error nobody catches, or nothing left to do
//   a page        imported by a constant name or by a name put together at run time, once or twice
//
// Only main.ts prints, and it waits for every answer, so the order of the lines is fixed. An error prints its name alone.
//
// A finding: a command that ends by a signal or runs out of its clock, a build that is refused, an executable that prints something else. One folder a finding in --out, at most three of one kind and first difference.
import { spawn } from "bun";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Random } from "./random";

const argument = (name: string, otherwise?: string) => {
  const at = process.argv.indexOf("--" + name);
  if (at > 0) return process.argv[at + 1];
  if (otherwise === undefined) throw new Error(`--${name} is missing`);
  return otherwise;
};

const shared = `export interface Order {
  id: number;
  name: string;
  inner: { x: number; y: number };
  tags?: string[];
}
export class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  length(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}
export let counter = 0;
export const bump = (by: number): number => (counter += by);
export const table = new Map<string, number>();
export function describe(value: unknown, depth = 0): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? value.slice(0, 20) + ".." + value.length : value);
  if (typeof value !== "object" || value === null) return String(value);
  if (depth > 3) return "..";
  const inside = (each: unknown) => describe(each, depth + 1);
  if (value instanceof Date) return "Date(" + value.getTime() + ")";
  if (value instanceof RegExp) return String(value) + "@" + value.lastIndex;
  if (value instanceof Error) return value.name + "(" + value.message + ")";
  if (value instanceof Map) return "Map{" + [...value].map(([key, item]) => inside(key) + ">" + inside(item)).join() + "}";
  if (value instanceof Set) return "Set{" + [...value].map(inside).join() + "}";
  if (value instanceof ArrayBuffer) return "ArrayBuffer(" + value.byteLength + ")";
  if (ArrayBuffer.isView(value)) return value.constructor.name + "(" + value.byteLength + ")[" + Array.from(new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 8))).join() + "]";
  if (Array.isArray(value)) return "[" + Array.from({ length: value.length }, (_, at) => (at in value ? inside(value[at]) : "hole")).join() + "]";
  return (value instanceof Point ? "Point" : Object.getPrototypeOf(value) === Object.prototype ? "" : "other") + "{" + Object.keys(value).map(key => key + ":" + inside((value as Record<string, unknown>)[key])).join() + "}";
}
`;

const payloads = [
  `1`,
  `-0`,
  `NaN`,
  `2147483648`,
  `1.5`,
  `"text"`,
  `"é€\\u{1f600}"`,
  `"ab".repeat(3000)`,
  `10n ** 30n`,
  `null`,
  `undefined`,
  `true`,
  `new Date(86400000)`,
  `/a+b/gi`,
  `new Map<unknown, unknown>([["a", 1], [2, { b: 3 }]])`,
  `new Set([1, "two", 3n])`,
  `new Uint8Array([1, 2, 3, 250])`,
  `new Float64Array([1.5, -0])`,
  `new Uint8Array([9, 8, 7, 6]).buffer`,
  `new RangeError("of main")`,
  `[1, , 3]`,
  `[]`,
  `{}`,
  `new Point(3, -4)`,
  `[new Point(1, 2), new Point(3, 4)]`,
  `{ id: 1, name: "fits", inner: { x: 2, y: 3 } }`,
  `{ id: 2, name: "with tags", inner: { x: 1.5, y: -0 }, tags: ["a", "b"] }`,
  `{ name: "another order", inner: { y: 1, x: 2 }, id: 3 }`,
  `{ id: "a text", name: 5, inner: null }`,
  `{ id: 4 }`,
  `{ id: 5, name: "more", inner: { x: 1, y: 2, z: 3 }, extra: [1] }`,
  `Object.assign(Object.create(null), { id: 6 })`,
  `(() => { const self: Record<string, unknown> = { id: 7 }; self.self = self; return self; })()`,
  `() => 1`,
  `Symbol("s")`,
  `{ f() {} }`,
];

// What a Worker does with a message. `data` is what arrived.
const answers = [
  `describe(data)`,
  `data`,
  `[data, data]`,
  `describe((data as Order).inner.x + (data as Order).id)`,
  `describe((data as Order).name)`,
  `((order: Order) => describe(order.tags?.length) + describe(order.inner))(data as Order)`,
  `data instanceof Point ? data.length() : "no Point"`,
  `new Point(bump(1), table.size)`,
  `{ counter: bump(10), keys: [...table.keys()].join(), marker: String((globalThis as Record<string, unknown>).marker) }`,
  `new Point(1, 2).length()`,
  `new TypeError("of the worker")`,
  `new Map([[data, data]])`,
];

export function program(seed: number): { entries: string[]; files: Record<string, string>; notes: string } {
  const random = new Random(seed);
  const workers = random.weighted([[8, random.between(1, 3)], [1, random.between(5, 9)]]); // prettier-ignore
  const pages = random.pick([0, 0, 1, 2]);
  const files: Record<string, string> = { "shared.ts": shared };
  const notes: string[] = [];
  // What the programs of one build have in common, and where they differ.
  const hasOrder = random.chance(0.3);
  const hasOwnSettings = random.chance(0.2);
  const hasLargeText = random.chance(0.05);
  const declaresFor = random.chance(0.2) ? random.below(workers) : -1;
  if (hasOrder) {
    files["order.ts"] = `export const order: string[] = [];\n`;
    for (const side of ["left", "right", "middle"])
      files[`${side}.ts`] =
        `import { order } from "./order.ts";\n${side === "middle" ? `import "./left.ts";\n` : ""}order.push("${side}");\nexport const ${side} = order.length;\n`;
  }
  if (hasOwnSettings) {
    files["tsconfig.json"] = files["inner/tsconfig.json"] = JSON.stringify({
      compilerOptions: { paths: { "@lib": ["./lib.ts"] } },
    });
    files["lib.ts"] =
      `export const lib: string = "the outer one";\nexport const size = (value: { wide: number }): number => value.wide;\n`;
    files["inner/lib.ts"] =
      `export const lib: number = 7;\nexport const size = (value: { narrow: string }): number => value.narrow.length;\n`;
  }
  if (hasLargeText)
    files["large.ts"] =
      `export const large: number[] = [\n${Array.from({ length: 6000 }, (_, row) => "  " + Array.from({ length: 10 }, (_, at) => row * 10 + at).join(", ") + ",").join("\n")}\n];\n`;
  if (declaresFor >= 0)
    files["declares.ts"] =
      `declare global {\n  var declaredByOne: number;\n  interface Number {\n    doubled?: () => number;\n  }\n}\ndeclare module "./shared.ts" {\n  interface Point {\n    note?: string;\n  }\n}\nglobalThis.declaredByOne = 5;\nexport const declared = () => globalThis.declaredByOne;\n`;
  const sides = () => random.shuffled(["left", "right", "middle"]).slice(0, random.between(1, 3));
  const main: string[] = [
    ...(hasOrder ? [...sides().map(side => `import "./${side}.ts";`), `import { order } from "./order.ts";`] : []),
    ...(hasOwnSettings ? [`import { lib, size } from "@lib";`] : []),
    ...(hasLargeText ? [`import { large } from "./large.ts";`] : []),
    `import { bump, counter, describe, Point, table } from "./shared.ts";`,
    `import { Worker as NodeWorker } from "node:worker_threads";`,
    `const attempt = (run: () => unknown): string => {\n  try {\n    return describe(run());\n  } catch (error) {\n    return "throws " + (error as Error).name;\n  }\n};`,
    `(globalThis as Record<string, unknown>).marker = "main";`,
    `table.set("main", bump(100));`,
    ...(hasOrder ? [`console.log("order", order.join());`] : []),
    ...(hasOwnSettings ? [`console.log("lib", lib.toUpperCase(), size({ wide: 3 }));`] : []),
    ...(hasLargeText ? [`console.log("large", large.length, large[59999]);`] : []),
    `console.log("declared", typeof (globalThis as Record<string, unknown>).declaredByOne, "note" in new Point(1, 2));`,
  ];
  for (let index = 0; index < workers; index++) {
    const isNode = random.chance(0.4);
    const isInner = hasOwnSettings && random.chance(0.6);
    const file = `${isInner ? "inner/" : ""}w${index}.ts`;
    const up = isInner ? "../" : "./";
    const more = [
      ...(hasOrder ? [`order.join()`] : []),
      ...(hasOwnSettings
        ? [isInner ? `lib + 1` : `lib.toUpperCase()`, isInner ? `size({ narrow: "four" })` : `size({ wide: 3 })`]
        : []),
      ...(hasLargeText && index % 2 === 0 ? [`large.length + large[4321]`] : []),
      ...(declaresFor === index
        ? [`declared()`, `(new Point(1, 2).note = "noted")`]
        : [`typeof (globalThis as Record<string, unknown>).declaredByOne`]),
      ...(pages > 0 && index === 1 ? [`title`] : []),
    ];
    const named = random.pick([
      `"./${file}"`,
      `new URL("./${file}", import.meta.url)`,
      ...(isNode ? [] : [`new URL("./${file}", import.meta.url).href`]),
    ]);
    const answer = random.sample(answers, random.between(1, 3));
    const change = random.sample(
      [
        `bump(${index + 1});`,
        `table.set("w${index}", ${index});`,
        `Point.prototype.length = () => -${index + 1};`,
        `(globalThis as Record<string, unknown>).marker = "w${index}";`,
        `(Point.prototype as unknown as Record<string, unknown>).added = ${index};`,
        `Object.defineProperty(Point.prototype, "x", { get: () => ${index}, set() {}, configurable: true });`,
      ],
      random.below(4),
    );
    const end = random.pick(["terminate", "terminate", "exit", "throws", "nothing left"]);
    const sends = Array.from({ length: random.between(1, 5) }, () => random.pick(payloads));
    notes.push(`${file}: ${isNode ? "node" : "web"} ${end} ${sends.length} messages`);
    const reply = isNode ? `parentPort!.postMessage` : `postMessage`;
    const handler = `(data: unknown) => {\n  if (data === "the end") {\n    ${end === "exit" ? `process.exit(${index + 3});` : end === "throws" ? `throw new RangeError("nobody catches this");` : isNode ? `parentPort!.close();` : `process.exit(0);`}\n  }\n  turn++;\n  for (const make of [${answer.map(each => `() => (${each})`).join(", ")}]) {\n    try {\n      ${reply}(make());\n    } catch (error) {\n      ${reply}("throws " + (error as Error).name);\n    }\n  }\n}`;
    files[file] = [
      `import { bump, describe, Point, table, type Order } from "${up}shared.ts";`,
      ...(hasOrder
        ? [...sides().map(side => `import "${up}${side}.ts";`), `import { order } from "${up}order.ts";`]
        : []),
      ...(hasOwnSettings ? [`import { lib, size } from "@lib";`] : []),
      ...(hasLargeText && index % 2 === 0 ? [`import { large } from "${up}large.ts";`] : []),
      ...(declaresFor === index ? [`import { declared } from "${up}declares.ts";`] : []),
      ...(pages > 0 && index === 1 ? [`import { title } from "${up}page0.ts";`] : []),
      `const more = " " + [${more.join(", ")}].join(" ");`,
      isNode ? `import { parentPort, workerData } from "node:worker_threads";` : `declare var self: Worker;`,
      ...change,
      `let turn = 0;`,
      `const handle = ${handler};`,
      isNode
        ? `parentPort!.on("message", handle);\nparentPort!.postMessage("ready " + describe(workerData) + more);`
        : `self.onmessage = event => handle(event.data);\npostMessage("ready" + more);`,
      "",
    ].join("\n");
    main.push(
      `{`,
      isNode
        ? `  const worker = new NodeWorker(${named}, { workerData: ${random.pick(payloads.slice(0, 32))} });`
        : `  const worker = new Worker(${named});`,
      `  const waiting: ((value: string) => void)[] = [];\n  const arrived: string[] = [];\n  let gone = false;\n  const take = (line: string) => {\n    if (waiting.length) waiting.shift()!(line);\n    else arrived.push(line);\n    if (/^(exit|close)/.test(line)) {\n      gone = true;\n      for (const resolve of waiting.splice(0)) resolve("gone");\n    }\n  };\n  const next = () => (arrived.length ? Promise.resolve(arrived.shift()!) : gone ? Promise.resolve("gone") : new Promise<string>(resolve => waiting.push(resolve)));`,
      isNode
        ? `  worker.on("message", data => take("says " + describe(data)));\n  worker.on("error", error => take("error " + (error as Error).name));\n  worker.on("exit", code => take("exit " + code));`
        : `  worker.onmessage = event => take("says " + describe(event.data));\n  worker.onerror = event => (event.preventDefault(), take("error " + (/\\b[A-Z][A-Za-z]*Error\\b/.exec(String(event.message)) ?? ["?"])[0]));\n  worker.addEventListener("close", event => take("close " + (event as unknown as { code: number }).code));`,
      `  console.log("w${index}", await next());`,
    );
    for (const [at, payload] of sends.entries()) {
      const transfers = payload.endsWith(".buffer") && random.chance(0.5);
      main.push(
        `  {\n    const sent = attempt(() => {\n      const value${transfers ? "" : ": unknown"} = ${payload};\n      worker.postMessage(value${transfers ? `, [value]` : ""});\n      return ${transfers ? `value.byteLength` : `"sent"`};\n    });\n    console.log("w${index}.${at}", sent);\n    if (!sent.startsWith("throws")) for (let answer = 0; answer < ${answer.length}; answer++) console.log("w${index}.${at}", await next());\n  }`,
      );
    }
    if (end === "terminate") main.push(`  await worker.terminate();\n  console.log("w${index}", "terminated");`);
    else
      main.push(
        `  worker.postMessage("the end");\n  console.log("w${index}", await next());${end === "throws" ? `\n  console.log("w${index}", await next());` : ""}`,
      );
    main.push(
      `  console.log("w${index}", "main still has", counter, [...table.keys()].join(), new Point(3, 4).length(), attempt(() => new Point(5, 6).x), String((globalThis as Record<string, unknown>).marker), "added" in Point.prototype);`,
      `}`,
    );
  }
  for (let index = 0; index < pages; index++) {
    files[`page${index}.ts`] =
      `import { bump, table } from "./shared.ts";\ntable.set("page${index}", bump(1000));\nexport const title = "page ${index}";\nexport default () => table.size;\n`;
    const name = random.pick([
      `"./page${index}.ts"`,
      `"./page" + ${index} + ".ts"`,
      `["./page", ".ts"].join(String(${index}))`,
    ]);
    notes.push(
      `page${index}: ${name.includes("+") || name.includes("join") ? "by a name put together" : "by a constant name"}`,
    );
    main.push(
      `for (let time = 0; time < ${random.between(1, 2)}; time++) {\n  try {\n    const page = await import(${name});\n    console.log("page${index}", page.title, page.default(), counter);\n  } catch (error) {\n    console.log("page${index}", "throws", (error as Error).name);\n  }\n}`,
    );
  }
  main.push(`console.log("the end", counter, [...table.keys()].join());`, "");
  files["main.ts"] = main.join("\n");
  return {
    entries: ["main.ts", ...Object.keys(files).filter(file => /^(inner\/)?(w|page)\d/.test(file))],
    files,
    notes: notes.join(" . "),
  };
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const drawn = program(Number(argument("print")));
    console.log(`// ${drawn.notes}\n// entries: ${drawn.entries.join(" ")}`);
    for (const [file, text] of Object.entries(drawn.files))
      if (file !== "shared.ts") console.log(`// ---- ${file}\n${text}`);
    process.exit(0);
  }
  const bun = argument("bun");
  const work = argument("work");
  const out = argument("out");
  const until = Date.now() + Number(argument("seconds", "300")) * 1000;
  const firstSeed = Number(argument("seed", "1"));
  const flags = argument("flags", "").split(/\s+/).filter(Boolean);

  type Ended = { text: string; out: string; code: number | null; signal: string | number | null; late: boolean };
  const run = async (command: string[], cwd: string, seconds: number): Promise<Ended> => {
    const limited = [
      "/bin/sh",
      "-c",
      `prlimit --pid $$ --core=1:1 2> /dev/null || ulimit -c 0; exec "$@"`,
      "--",
      ...command,
    ];
    const child = spawn(limited, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    let late = false;
    const timer = setTimeout(() => ((late = true), child.kill(9)), seconds * 1000);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    return { text: stdout + stderr, out: stdout, code, signal: late ? null : child.signalCode, late };
  };

  const counts = new Map<string, number>();
  const count = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
  let findings = 0;
  const shapeOf = (text: string) =>
    text
      .replace(/\bw\d(\.\d)?\b/g, "w")
      .replace(/\d+/g, "N")
      .replace(/[^\w{}:.]+/g, "-")
      .slice(0, 90);
  function finding(kind: string, folder: string, seed: number, notes: string, said: string, shape = "") {
    findings++;
    const group = `${kind}${shape ? " " + shapeOf(shape) : ""}`.replace(/[^\w{}:.-]+/g, "-");
    count(`FINDING ${group}`);
    if (readdirSync(out).filter(name => name.startsWith(group + "-seed-")).length >= 3) return;
    const target = join(out, `${group}-seed-${seed}`);
    rmSync(join(folder, "app"), { force: true });
    cpSync(folder, target, { recursive: true });
    writeFileSync(
      join(target, "finding.txt"),
      `${kind}\nseed ${seed}\nflags ${flags.join(" ")}\n${notes}\n\n${said.slice(0, 6000)}\n`,
    );
  }

  async function one(seed: number, job: number) {
    const folder = join(work, "job-" + job);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const { entries, files, notes } = program(seed);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, file)), { recursive: true });
      writeFileSync(join(folder, file), text);
    }
    const plain = await run([bun, "--no-install", entries[0]], folder, 40);
    if (plain.signal)
      return finding("plain Bun ends by a signal", folder, seed, notes, plain.text, String(plain.signal));
    if (plain.late) return finding("plain Bun hangs", folder, seed, notes, plain.text);
    // Plain Bun twice: what it prints in another order each time says nothing about an executable.
    if ((await run([bun, "--no-install", entries[0]], folder, 40)).out !== plain.out)
      return void count("plain Bun prints something else each time");
    const build = await run(
      [
        bun,
        "build",
        "--compile",
        "--aot",
        "--aot-threads=1",
        ...flags,
        ...entries.map(entry => `./${entry}`),
        "--outfile",
        "app",
      ],
      folder,
      300,
    );
    if (build.late) return finding("the build hangs", folder, seed, notes, build.text);
    if (build.signal || /\bpanic(ked)?\b|ASSERTION FAILED|internal compiler error/.test(build.text))
      return finding(
        "the build ends badly",
        folder,
        seed,
        notes,
        build.text,
        /^.*(panic|ASSERTION FAILED|internal compiler error).*$/m.exec(build.text)?.[0] ?? String(build.signal),
      );
    if (build.code !== 0 || !existsSync(join(folder, "app")))
      return finding(
        "the build is refused",
        folder,
        seed,
        notes,
        build.text,
        /^.*error.*$/im.exec(build.text)?.[0] ?? "",
      );
    let compiled = await run(["./app"], folder, 40);
    // A machine under load makes a short run long: what is not through in its time gets five times as long, once.
    if (compiled.late) compiled = await run(["./app"], folder, 200);
    if (compiled.signal)
      return finding(
        "the executable ends by a signal",
        folder,
        seed,
        notes,
        `${compiled.signal}\n${compiled.text}`,
        String(compiled.signal),
      );
    if (compiled.late)
      return finding("the executable hangs", folder, seed, notes, compiled.text, compiled.out.split("\n").at(-2) ?? "");
    if (compiled.out === plain.out && compiled.code === plain.code) return void count("as plain");
    const [expected, got] = [plain.out.split("\n"), compiled.out.split("\n")];
    const at = expected.findIndex((line, index) => line !== got[index]);
    finding(
      "the executable prints something else",
      folder,
      seed,
      notes,
      `exit codes ${plain.code} ${compiled.code}\nline ${at + 1}\nplain:    ${expected[at]}\ncompiled: ${got[at]}\n\n== plain\n${plain.text}\n== compiled\n${compiled.text}`,
      `${expected[at] ?? "the end"} | ${got[at] ?? "the end"}`,
    );
  }

  mkdirSync(out, { recursive: true });
  let next = firstSeed;
  await Promise.all(
    Array.from({ length: Number(argument("jobs", "8")) }, async (_, job) => {
      while (Date.now() < until) await one(next++, job);
      rmSync(join(work, "job-" + job), { recursive: true, force: true });
    }),
  );
  console.log(`programs ${next - firstSeed} | findings ${findings}`);
  for (const [what, times] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(times).padStart(6), what);
  process.exit(0);
}
