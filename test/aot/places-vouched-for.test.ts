// Built-in JavaScript reads properties by keys that the compiler does not see. Where every such place of a file has been read and
// shown to be harmless, src/codegen/builtins-manifest.ts vouches for the file. The compiler says how many places each voucher stands
// for. A number above the one here means that a place was added: read the new place as the others were read (can the key be a name
// the program chose, and can the receiver be anything but the file's own table?), then change the number. Fewer places are no
// alarm: which built-in functions a program holds, and how finely the compiler judges a key, changes with other work.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

const program = `declare const require: any, console: any;
console.log(require("node:http"), require("node:https"), require("node:child_process"), require("node:readline/promises"), require("node:util"), require("node:url"), require("node:querystring"), require("node:punycode"), require("bun:sqlite"));`;

const places: Record<string, number> = {
  "builtins/Bake.ts": 7,
  "builtins/BundlerPlugin.ts": 3,
  "builtins/CommonJS.ts": 2,
  "builtins/ConsoleObject.ts": 4,
  "builtins/Peek.ts": 1,
  "builtins/ProcessObjectInternals.ts": 12,
  "bun/sqlite.ts": 2,
  "engine/ArrayIteratorPrototype.js": 1,
  "engine/ArrayPrototype.js": 1,
  "engine/JSIteratorConstructor.js": 1,
  "engine/ObjectConstructor.js": 1,
  "engine/ReflectObject.js": 1,
  "engine/ShadowRealmPrototype.js": 1,
  "engine/TypedArrayPrototype.js": 1,
  "internal/primordials.js": 5,
  "internal/shared.ts": 1,
  "internal/util/inspect.ts": 10,
  "node/diagnostics_channel.ts": 2,
  "node/os.ts": 2,
  "node/punycode.ts": 1,
  "node/querystring.ts": 6,
  "node/url.ts": 4,
};

test("every place that a voucher stands for has been read", async () => {
  using dir = tempDir("aot-places-vouched-for", { "tsconfig.json": tsconfig, "main.ts": program });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const found: Record<string, number> = {};
  for (const line of stderr.split("\n").sort()) {
    const [, file, count] = /^aot: runtime use: vouched property \* \/\$bun\/js\/(\S+) (\d+)$/.exec(line) ?? [];
    if (file) found[file.toLowerCase()] = Number(count);
  }
  const read = Object.fromEntries(Object.entries(places).map(([file, count]) => [file.toLowerCase(), count]));
  expect({ exitCode, more: Object.entries(found).filter(([file, count]) => !(count <= read[file])) }).toEqual({ exitCode: 0, more: [] });
  expect(Object.keys(read).filter(file => /^(bun|internal|node)\//.test(file) && !(file in found))).toEqual([]);
});
