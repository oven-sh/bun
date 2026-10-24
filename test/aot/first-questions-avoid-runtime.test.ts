import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const kinds = 40;
const names = Array.from({ length: 12 }, (_, index) => "n" + index);
const files = {
  "main.mjs": `
    const literals = [
      ${Array.from({ length: kinds }, (_, index) => `() => ({ own${index}: ${index}, n${index % 12}: 1, n${(index + 5) % 12}: 2 }),`).join("\n      ")}
    ];
    const classes = [
      ${Array.from({ length: kinds }, (_, index) => `class C${index} { own${index} = ${index}; n${index % 12} = 1; n${(index + 5) % 12}() { return 2; } get n${(index + 7) % 12}() { return 3; } },`).join("\n      ")}
    ];
    function rebuild(o) { const built = {}; for (const key of Object.keys(o)) built[key] = o[key]; return built; }
    function extend(o, index) { o["extra" + index] = index; return o; }
    function shrink(o) { o.gone = 1; delete o.gone; return o; }
    const makers = {
      ordinary: index => Object.fromEntries(Object.entries(literals[index]())),
      rebuilt: index => rebuild(literals[index]()),
      extended: index => extend(literals[index](), index),
      instances: index => new classes[index](),
      dictionaries: index => shrink(Object.fromEntries(Object.entries(literals[index]()))),
      heirs: index => Object.create(Object.fromEntries(Object.entries(literals[index]()))),
      heirsOfRebuilt: index => Object.create(rebuild(literals[index]())),
    };
    const keys = ${JSON.stringify(names)}.map(name => (name + process.argv.length).slice(0, name.length));
    const ways = {
      nothing(o) { return 0; },
      read(o) { let sum = 0, v; ${names.map(name => `v = o.${name}; if (v !== undefined) sum++;`).join(" ")} return sum; },
      in(o) { let sum = 0; ${names.map(name => `if ("${name}" in o) sum++;`).join(" ")} return sum; },
      hasOwn(o) { let sum = 0; ${names.map(name => `if (Object.hasOwn(o, "${name}")) sum++;`).join(" ")} return sum; },
      readByKey(o) { let sum = 0; for (const key of keys) if (o[key] !== undefined) sum++; return sum; },
      inByKey(o) { let sum = 0; for (const key of keys) if (key in o) sum++; return sum; },
    };
    const [way, kind] = process.argv.slice(2);
    // The objects come back out of the global object, so the compiler does not know which layouts arrive.
    globalThis[process.argv.length > 99 ? process.argv[9] : "hidden"] = Array.from({ length: ${kinds} }, (_, index) => makers[kind](index));
    if (kind === "instances") for (const o of globalThis.hidden) for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(o))) Reflect.get(o, name);
    let sum = 0;
    for (const o of globalThis.hidden) sum += ways[way](o);
    console.log(sum);
  `,
};

const operations =
  /^operationAOT(GetById|GetByIdAndCache|GetGeneric|GetByVal|GetByValGeneric|GetByValAndCache|InById|InByIdAndCache|InByVal|InByValGeneric|InByValAndCache|HasOwnByIdAndCache|HasOwnByValAndCache|HasOwnGeneric)$/;

test("the first question about a name and a kind of object is answered without leaving compiled code", async () => {
  using dir = tempDir("aot-first-questions", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const leftOften: string[] = [];
  for (const kind of ["ordinary", "rebuilt", "extended", "instances", "dictionaries", "heirs", "heirsOfRebuilt"]) {
    // What it takes to start and to make the objects.
    let callsBeforeQuestions = 0;
    for (const way of ["nothing", "read", "in", "hasOwn", "readByKey", "inByKey"]) {
      const expected = await run([bunExe(), "main.mjs", way, kind], String(dir), bunEnv);
      const path = join(String(dir), "counts-" + kind + way);
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, way, kind], String(dir), env)).toEqual({
        stdout: expected.stdout,
        stderr: "",
        exitCode: 0,
      });
      let calls = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name !== undefined && operations.test(name)) calls += Number(count);
      }
      // 480 questions, each about a kind of object and a name that were never asked together before.
      if (way === "nothing") callsBeforeQuestions = calls;
      else if (calls - callsBeforeQuestions >= kinds)
        leftOften.push(`${kind} ${way}: ${calls - callsBeforeQuestions} calls`);
    }
  }
  expect(leftOften).toEqual([]);
}, 600_000);

const emptyFields = {
  "main.mjs": `
    class Core {
      constructor(options) {
        this.update = newOptions => {
          this.options = { ...this.options, ...newOptions };
          if (this.options.tree !== this.tree) { this.tree = this.options.tree; this.build(); }
        };
        this.build = () => { this.built = (this.built ?? 0) + 1; };
        this.update(options);
      }
      get state() { return this.built; }
      load() { return this.tree.length + this.state; }
    }
    class Router extends Core { constructor(options) { super(options); } }
    globalThis[process.argv.length > 99 ? process.argv[9] : "hidden"] = { make: options => new Router(options), read: router => router.tree };
    let sum = 0;
    const tree = [1, 2, 3];
    for (let round = 0; round < 4000; round++) {
      const router = globalThis.hidden.make({ tree });
      sum += router.load() + globalThis.hidden.read(router).length;
      if (round % 1000 === 999) Bun.gc(true);
    }
    console.log(sum);
  `,
};

test("a read of a field whose slot is still empty stays cached when the lookup that files it is the one that gives the prototype objects their members", async () => {
  using dir = tempDir("aot-empty-fields-below-a-class", emptyFields);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const path = join(String(dir), "counts");
  expect(
    await run([executable], String(dir), { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path }),
  ).toEqual({ stdout: "28000\n", stderr: "", exitCode: 0 });
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (name !== undefined && operations.test(name)) calls += Number(count);
  }
  expect(calls).toBeLessThan(400);
}, 240_000);
