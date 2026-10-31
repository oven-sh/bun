import { describe, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { spawned, unsupported } from "./harness/commands";
import { afterAll, beforeAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

// `bun test --isolate` gives each test file a fresh realm of one VM. A native addon is loaded once for the process, so what it keeps in a C static
// is there for the next file, in plain Bun too: an object of the realm before, which inherits from that realm's prototypes and was made by that realm's evaluation of its class.
// Every realm runs the same compiled image, so such an object looks like one of this realm: an array is marked as its class made it, an instance has the layout of the class.
// `list instanceof Array` was answered by that mark, and `#v in box`, `box.#v` by that layout.
const keep = `#include <node_api.h>
static napi_ref kept;
static napi_value keep(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value value, undefined;
  napi_get_cb_info(env, info, &count, &value, NULL, NULL);
  napi_create_reference(env, value, 1, &kept);
  napi_get_undefined(env, &undefined);
  return undefined;
}
static napi_value take(napi_env env, napi_callback_info info) {
  napi_value value = NULL;
  if (!kept || napi_get_reference_value(env, kept, &value) != napi_ok || !value)
    napi_get_undefined(env, &value);
  return value;
}
NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "keep", NAPI_AUTO_LENGTH, keep, NULL, &function);
  napi_set_named_property(env, exports, "keep", function);
  napi_create_function(env, "take", NAPI_AUTO_LENGTH, take, NULL, &function);
  napi_set_named_property(env, exports, "take", function);
  return exports;
}
`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "bag.mjs": `export class Box {
  #v;
  #m() { return this.#v; }
  constructor(v) { this.#v = v; }
  static is(x) { return #v in x; }
  static hasMethod(x) { return #m in x; }
  static read(x) { return x.#v; }
  static write(x, v) { x.#v = v; return "written"; }
  static call(x) { return x.#m(); }
}
export class Below extends Box { extra = 1; }
export const makeBag = () => ({
  list: [1, 2], doubles: [1.5], words: ["a"], empty: [], object: { a: 1 }, map: new Map([[1, 2]]), set: new Set([1]), error: new TypeError("t"), date: new Date(0),
  promise: Promise.resolve(1), fn: function named() {}, regexp: /a/, bytes: new Uint8Array(2), buffer: new ArrayBuffer(2), weak: new WeakMap(), box: new Box(5), below: new Below(6),
  askList: x => x instanceof Array, askMap: x => x instanceof Map, askAfterPush: x => { x.push(1); x.pop(); return x instanceof Array; }, onlyEverGivenLists,
  isBox: x => Box.is(x), readBox: x => Box.read(x), askBox: x => x instanceof Box,
});
// Every call that the program writes hands it a list of its own.
function onlyEverGivenLists(x) { return x instanceof Array; }
export const givenOwnLists = () => [onlyEverGivenLists([1]), onlyEverGivenLists([2, 3])];
`,
  "asks.mjs": `import { Box, Below, makeBag, givenOwnLists } from "./bag.mjs";
const addon = { exports: {} };
process.dlopen(addon, process.env.ADDON);
export function asks(name) {
  const tell = (label, run) => { try { console.log("SEEN", name, label, String(run())); } catch (e) { console.log("SEEN", name, label, "THROWS " + e?.constructor?.name); } };
  const look = (who, bag) => {
    tell(who + " instanceof:", () => [bag.list instanceof Array, bag.doubles instanceof Array, bag.words instanceof Array, bag.empty instanceof Array, bag.object instanceof Object, bag.map instanceof Map, bag.set instanceof Set, bag.error instanceof TypeError, bag.error instanceof Error, bag.date instanceof Date, bag.promise instanceof Promise, bag.fn instanceof Function, bag.regexp instanceof RegExp, bag.bytes instanceof Uint8Array, bag.buffer instanceof ArrayBuffer, bag.weak instanceof WeakMap, bag.list instanceof Object]);
    tell(who + " instanceof another class:", () => [bag.list instanceof Map, bag.map instanceof Array, bag.error instanceof RangeError]);
    tell(who + " after a method has run on it:", () => { const list = bag.list; list.push(3); list.pop(); return list instanceof Array; });
    tell(who + " what its methods make:", () => [bag.list.map(x => x) instanceof Array, bag.list.slice() instanceof Array, [...bag.list] instanceof Array]);
    tell(who + " whatever the realm:", () => [Array.isArray(bag.list), bag.list.length, bag.map.size, bag.object.a]);
    tell(who + " private in:", () => [Box.is(bag.box), Box.hasMethod(bag.box), Box.is(bag.below), Box.is(bag.object), Box.is(bag.list)]);
    tell(who + " private read:", () => Box.read(bag.box));
    tell(who + " private read of an instance of a class below:", () => Box.read(bag.below));
    tell(who + " private write:", () => Box.write(bag.box, 7));
    tell(who + " private method:", () => Box.call(bag.box));
    tell(who + " classes of the program:", () => [bag.box instanceof Box, bag.below instanceof Below, bag.below instanceof Box]);
  };
  const ours = makeBag();
  look("ours", ours);
  const theirs = addon.exports.take();
  if (theirs !== undefined) look("theirs", theirs);
  // A function runs in the realm that made it, whoever calls it.
  const across = (who, functions, whose, bag) => {
    tell(who + " functions asked about " + whose + " objects:", () => [functions.askList(bag.list), functions.askMap(bag.map), functions.askAfterPush(bag.list), functions.onlyEverGivenLists(bag.list), functions.isBox(bag.box), functions.askBox(bag.box)]);
    tell(who + " function reads the private field of " + whose + " box:", () => functions.readBox(bag.box));
  };
  tell("lists of its own:", () => givenOwnLists());
  across("our", ours, "our", ours);
  if (theirs !== undefined) { across("our", ours, "their", theirs); across("their", theirs, "our", ours); across("their", theirs, "their", theirs); }
  addon.exports.keep(makeBag());
}
`,
  "a.test.mjs": `import { test } from "bun:test"; import { asks } from "./asks.mjs"; test("a", () => asks("a"));`,
  "b.test.mjs": `import { test } from "bun:test"; import { asks } from "./asks.mjs"; test("b", () => asks("b"));`,
};

const ours = (name: string) => [
  `SEEN ${name} ours instanceof: ${Array(17).fill(true)}`,
  `SEEN ${name} ours instanceof another class: false,false,false`,
  `SEEN ${name} ours after a method has run on it: true`,
  `SEEN ${name} ours what its methods make: true,true,true`,
  `SEEN ${name} ours whatever the realm: true,2,1,1`,
  `SEEN ${name} ours private in: true,true,true,false,false`,
  `SEEN ${name} ours private read: 5`,
  `SEEN ${name} ours private read of an instance of a class below: 6`,
  `SEEN ${name} ours private write: written`,
  `SEEN ${name} ours private method: 7`,
  `SEEN ${name} ours classes of the program: true,true,true`,
];
const acrossOurs = (name: string) => [
  `SEEN ${name} lists of its own: true,true`,
  `SEEN ${name} our functions asked about our objects: true,true,true,true,true,true`,
  `SEEN ${name} our function reads the private field of our box: 7`,
];

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
if (!systemCC) console.error(`SKIPPED: ${import.meta.file}: there is no C compiler: not in $CC, no cc, gcc or clang`);

describe.skipIf(!systemCC || !!unsupported)("an object that a native addon kept from the test file before", () => {
  const folder = String(tempDir("aot-an-object-of-an-earlier-test-file", { ...files, "keep.c": keep }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const addon = join(folder, "keep.node");

  beforeAll(async () => {
    const functionsOfTheHost = join(folder, "functions-of-the-host.h");
    if (isWindows) {
      const called = new Set(keep.match(/\bnapi_\w+(?=\()/g));
      writeFileSync(
        functionsOfTheHost,
        `#include <node_api.h>\nvoid* GetModuleHandleW(const void*);\nvoid* GetProcAddress(void*, const char*);\n#define HOST(function) ((__typeof__(&function))GetProcAddress(GetModuleHandleW(NULL), #function))\n` +
          [...called].map(name => `#define ${name} HOST(${name})\n`).join(""),
      );
    }
    const compile = await spawned(
      [
        systemCC!,
        "-shared",
        ...(isWindows ? ["-include", functionsOfTheHost] : ["-fPIC"]),
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        join(folder, "keep.c"),
        "-o",
        addon,
      ],
      folder,
      bunEnv,
    );
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  });

  async function runTests(words: string | undefined, ...flags: string[]) {
    const env = { ...bunEnv, ADDON: addon, ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}) };
    const command = [bunExe(), "test", "--isolate", ...flags, "./a.test.mjs", "./b.test.mjs"];
    const { stdout, stderr, exitCode } = await run(command, folder, env);
    if (exitCode !== 0) console.error(stderr);
    return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
  }

  for (const [way, words] of [
    ["as one program", "TestRunLayers:0"],
    ["over two layers, both files in one process", "TestRunLayers:2,TestRunPartFiles:3"],
  ]) {
    test(`is an instance of no class of this realm, ${way}`, async () => {
      const plain = await runTests(undefined);
      expect(plain).toEqual({
        stdout: [
          ...ours("a"),
          ...acrossOurs("a"),
          ...ours("b"),
          `SEEN b theirs instanceof: ${Array(17).fill(false)}`,
          "SEEN b theirs instanceof another class: false,false,false",
          "SEEN b theirs after a method has run on it: false",
          "SEEN b theirs what its methods make: false,false,true",
          "SEEN b theirs whatever the realm: true,2,1,1",
          "SEEN b theirs private in: false,false,false,false,false",
          "SEEN b theirs private read: THROWS TypeError",
          "SEEN b theirs private read of an instance of a class below: THROWS TypeError",
          "SEEN b theirs private write: THROWS TypeError",
          "SEEN b theirs private method: THROWS TypeError",
          "SEEN b theirs classes of the program: false,false,false",
          ...acrossOurs("b"),
          "SEEN b our functions asked about their objects: false,false,false,false,false,false",
          "SEEN b our function reads the private field of their box: THROWS TypeError",
          "SEEN b their functions asked about our objects: false,false,false,false,false,false",
          "SEEN b their function reads the private field of our box: THROWS TypeError",
          "SEEN b their functions asked about their objects: true,true,true,true,true,true",
          "SEEN b their function reads the private field of their box: 5",
        ],
        exitCode: 0,
      });
      expect(await runTests(words, "--aot")).toEqual(plain);
    }, 180_000);
  }
});
