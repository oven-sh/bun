// A module of Bun's library whose body threw is left as if it had not run: the next require runs the body again, as in plain
// Bun. The body was compiled to be entered once, so the run time first forgets the classes, closures and variables of the
// run that threw. Where it forgets too little, the second run defines a class a second time and the process ends by a signal.
//
// One executable holds every module. A run takes one writable global away, requires every module twice, puts the global back,
// requires every module again and uses an export of each. No run may end by a signal. Where a body threw, plain Bun runs
// the same program, and the modules go on as they go on there.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { beforeAll, describe, test } from "./supported";

// What node:module does not list: only the test runner provides bun:test.
const modules = [
  ...builtinModules.filter(name => name !== "bun:test"),
  "node:test",
  "node:quic",
  "node-fetch",
  "isomorphic-fetch",
  "@vercel/fetch",
];

// One use of an export, which calls into the module where that takes no more than a line. A module without a row is asked for its type.
const uses: Record<string, string> = {
  "bun:sqlite": `new m.Database(":memory:").query("select 1 as x").get().x`,
  "node:sqlite": `new m.DatabaseSync(":memory:").prepare("select 1 as x").get().x`,
  "node:test": `typeof m.test + typeof m.describe`,
  "bun:ffi": `typeof m.dlopen + m.suffix`,
  "bun:jsc": `typeof m.heapSize()`,
  bun: `typeof m.file + m.hash("a")`,
  assert: `m.deepStrictEqual({ a: [1] }, { a: [1] })`,
  "assert/strict": `m.deepEqual({ a: [1] }, { a: [1] })`,
  async_hooks: `new m.AsyncLocalStorage().run(1, () => 2)`,
  buffer: `m.Buffer.from("a").toString("hex")`,
  child_process: `typeof m.spawn`,
  cluster: `m.isPrimary`,
  console: `typeof new m.Console(process.stdout).log`,
  crypto: `m.createHash("sha1").update("a").digest("hex")`,
  dgram: `m.createSocket("udp4").close()`,
  diagnostics_channel: `m.channel("a").hasSubscribers`,
  dns: `typeof m.lookup`,
  domain: `typeof m.create().run`,
  events: `new m.EventEmitter().on("a", () => {}).emit("a")`,
  fs: `m.existsSync(".")`,
  "fs/promises": `typeof m.readFile`,
  http: `new m.Agent().maxSockets + m.STATUS_CODES[200]`,
  http2: `m.constants.NGHTTP2_NO_ERROR`,
  https: `new m.Agent().maxSockets`,
  module: `m.isBuiltin("node:fs")`,
  net: `new m.Socket().destroy().destroyed + m.isIP("::1")`,
  os: `typeof m.platform() + m.EOL.length`,
  path: `m.join("a", "..", "b")`,
  perf_hooks: `typeof m.performance.now()`,
  punycode: `m.toASCII("ma\\u00f1ana.com")`,
  querystring: `m.stringify({ a: [1, 2] })`,
  readline: `typeof m.createInterface`,
  stream: `new m.PassThrough().end("a").read().length`,
  "stream/web": `typeof new m.ReadableStream().getReader`,
  string_decoder: `new m.StringDecoder("utf8").write(Buffer.from("a"))`,
  timers: `m.clearTimeout(m.setTimeout(() => {}, 1))`,
  tty: `m.isatty(99)`,
  url: `new m.URL("http://a/b?c=1").search + m.parse("http://a:1/b").host`,
  util: `m.format("%s %d", "a", 1) + m.inspect({ a: [1, "b"] })`,
  "util/types": `m.isRegExp(/a/)`,
  v8: `m.deserialize(m.serialize({ a: 1 })).a`,
  vm: `m.runInNewContext("1 + 1")`,
  worker_threads: `m.isMainThread`,
  zlib: `m.gunzipSync(m.gzipSync("a")).toString()`,
  undici: `new m.Headers({ a: "1" }).get("a")`,
  ws: `typeof m.WebSocket`,
  "node-fetch": `new m.Response("a", { status: 201 }).status`,
};

const cases = (arm: (name: string) => string) =>
  modules.map(name => `    case ${JSON.stringify(name)}: return ${arm(name)};`).join("\n");
// It keeps in variables what it needs itself while a global is away.
const program = `
const realm = globalThis;
const print = console.log.bind(console);
const exit = process.exit.bind(process);
const { stringify } = JSON;
const names = ${JSON.stringify(modules)};
function load(name) {
  switch (name) {
${cases(name => `require(${JSON.stringify(name)})`)}
  }
}
function use(name) {
  switch (name) {
${cases(name => `(m => ${uses[name] ?? "typeof m"})(require(${JSON.stringify(name)}))`)}
  }
}
function attempt(name) {
  try {
    return { value: load(name) };
  } catch (error) {
    return { error };
  }
}
function writableGlobals() {
  return Object.getOwnPropertyNames(realm).filter(name => {
    const { writable, set } = Object.getOwnPropertyDescriptor(realm, name);
    return writable || set !== undefined;
  });
}

const taken = process.argv[2];
const globals = taken === undefined ? writableGlobals() : undefined;
const real = realm[taken];
if (taken !== undefined) {
  // Built-in objects are read-only in an executable: the store throws, and in plain Bun it does nothing. onmessage and onerror turn undefined into null.
  try {
    realm[taken] = undefined;
  } catch {}
  if (realm[taken] != null) {
    print(stringify({ isReadOnly: true }));
    exit(0);
  }
}
const first = names.map(attempt);
const second = names.map(attempt);
if (taken !== undefined) realm[taken] = real;
const third = names.map(attempt);

const nameOf = error => {
  try {
    return String(error.name);
  } catch {
    return "a value";
  }
};
const isObject = value => (typeof value === "object" && value !== null) || typeof value === "function";
// node:console answers with the global console, which may be the global that is away.
const answer = ({ value, error }) => (error !== undefined ? "threw " + nameOf(error) : isObject(value) ? "exports" : "no object");
const again = (now, before) => (now.value === before.value && now.error === before.error ? "the same" : answer(now));
print(
  stringify({
    globals,
    answers: names.map((name, index) => {
      let used;
      if (third[index].error === undefined) {
        try {
          use(name);
          used = "used";
        } catch (error) {
          used = nameOf(error);
        }
      }
      return [name, answer(first[index]), again(second[index], first[index]), again(third[index], first[index]), used];
    }),
  }),
);
exit(0);
`;

type Answers = [name: string, first: string, second: string, third: string, used?: string][];
type Printed = { globals?: string[]; isReadOnly?: true; answers?: Answers };

// What `bun compile` lets no program replace. A run for one of them has nothing to ask.
const readOnlyGlobals = [
  "Array",
  "ArrayBuffer",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Proxy",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakSet",
  "globalThis",
  "process",
];

describe("a module of the library whose body threw is required again", () => {
  // Made where the tests run: a Bun without the compiler skips them and makes no folder.
  let dir: ReturnType<typeof tempDir> | undefined;
  let executable: string;
  afterAll(() => dir?.[Symbol.dispose]());

  /** What the program printed, or how the run ended where it printed nothing. */
  async function ran(command: string[], taken?: string): Promise<Printed | string> {
    const { stdout, stderr, exitCode, signal } = await slot(() =>
      spawned(taken === undefined ? command : [...command, taken], String(dir), bunEnv),
    );
    const printed = stdout.trim().split("\n").at(-1)!;
    if (exitCode === 0 && printed.startsWith("{")) return JSON.parse(printed);
    const panic = /^panic.*$/m.exec(stderr)?.[0];
    const frames = /^Compiled JavaScript on the stack:\n((?: +at .*\n)+)/m.exec(stderr)?.[1];
    return `ended by ${signal ?? `exit code ${exitCode}`}\n${panic ?? stderr.slice(-600)}\n${frames ?? ""}`;
  }

  let withEveryGlobal: Printed | string;
  beforeAll(
    async () => {
      dir = tempDir("aot-library-module-required-again", { "main.cjs": program });
      executable = join(String(dir), isWindows ? "main.exe" : "main");
      const build = [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable];
      // A debug build of Bun takes four minutes to compile the library.
      built(await slot(() => spawned(build, String(dir), bunEnv, isDebug ? 480_000 : undefined)));
      withEveryGlobal = await ran([executable]);
    },
    isDebug ? 540_000 : 300_000,
  );

  test("with every global in its place each module is loaded once and its export is used", () => {
    expect(Object.keys(uses).filter(name => !modules.includes(name))).toEqual([]);
    expect(withEveryGlobal).toEqual({
      globals: expect.arrayContaining(["Error", "WeakMap"]),
      answers: modules.map(name => [name, "exports", "the same", "the same", "used"]),
    });
  });

  test("with a global taken away no run ends by a signal, and each module answers as it does in plain Bun", async () => {
    if (typeof withEveryGlobal === "string") throw new Error(withEveryGlobal);
    let threw = 0;
    const refused: string[] = [];
    const failures: string[] = [];
    await Promise.all(
      withEveryGlobal.globals!.map(async taken => {
        const compiled = await ran([executable], taken);
        if (typeof compiled === "string") return void failures.push(`without ${taken}: ${compiled}`);
        if (compiled.isReadOnly) return void refused.push(taken);
        const answers = compiled.answers!;
        // A module that is loaded is not loaded again.
        for (const [name, first, second, third] of answers)
          if (first === "exports" && (second !== "the same" || third !== "the same"))
            failures.push(`without ${taken}: ${name} answered ${first}, ${second}, ${third}`);
        const threwHere = answers.filter(([, first]) => first.startsWith("threw")).length;
        if (!threwHere) return;
        threw += threwHere;
        // Where a body threw, plain Bun runs the same program. Which globals a module reads while it loads is its own affair, and
        // the library of an executable reads fewer: a module that began there as it began here goes on the same way.
        const plain = await ran([bunExe(), "main.cjs"], taken);
        if (typeof plain === "string") return void failures.push(`without ${taken}, in plain Bun: ${plain}`);
        answers.forEach(([name, first, ...later], index) => {
          const [, firstInPlainBun, ...laterInPlainBun] = plain.answers![index];
          if (first === firstInPlainBun && !Bun.deepEquals(later, laterInPlainBun))
            failures.push(
              `without ${taken}: ${name} answered ${first}, ${later.join(", ")}, and in plain Bun ${first}, ${laterInPlainBun.join(", ")}`,
            );
        });
      }),
    );
    expect(failures).toEqual([]);
    // Every other global was taken away: a global that becomes read-only leaves the runs by name, not in silence.
    expect(refused.sort()).toEqual(readOnlyGlobals);
    // The body of some module reads a writable global: the runs asked the question.
    expect(threw).toBeGreaterThan(0);
  });
});
