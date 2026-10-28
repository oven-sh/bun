import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["bun"],
    },
  }),
  "wasm.d.ts": `declare module "*.wasm" { const path: string; export default path; }`,
  // (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
  "adds.wasm": Buffer.from("0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b", "hex"),
  "broken.wasm": Buffer.from([0, 1, 2, 3]),
  "partly.wasm": readFileSync(
    join(import.meta.dir, "..", "programs", "webassembly", "partly-interpreted-module", "module.wasm"),
  ),
  "interpreted.ts": `import brokenPath from "./broken.wasm";
import partlyPath from "./partly.wasm";
const text = process.argv[2] ?? "aab";
console.log(/abcdef+/.test(text));
console.log(/ab+/.test(text));
console.log(new RegExp(process.argv[3] ?? "a+").test(text));
console.log(new RegExp("a+b").test(text));
console.log(typeof brokenPath, typeof partlyPath);
`,
  "compiled.ts": `import addsPath from "./adds.wasm";
const text = process.argv[2] ?? "aab";
console.log(/ab+/.test(text), new RegExp("a+b").test(text));
const adds = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(addsPath).arrayBuffer())), {});
console.log((adds.exports.add as (a: number, b: number) => number)(19, 23));
`,
};

const runEnv = {
  "interpreted.ts": bunEnv,
  "compiled.ts": { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
};

async function build(entry: keyof typeof runEnv, ...flags: string[]) {
  using dir = tempDir("aot-explain-missed-optimizations", files);
  const folder = String(dir);
  const command = [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", "out"];
  const result = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  built(result);
  const ran = await spawned([join(folder, isWindows ? "out.exe" : "out")], folder, runEnv[entry]);
  return { lines: (result.stdout + result.stderr).split("\n"), ran };
}

function interpreterWarnings(lines: string[]) {
  const prefix = "warn: TS100058: ";
  return lines
    .flatMap((line, index) => {
      if (!line.startsWith(prefix)) return [];
      const [, file, lineNumber] = /^ +at .*?([^\\/]+):(\d+):\d+$/.exec(lines[index + 1] ?? "") ?? [];
      return [`${line.slice(prefix.length)} at ${file}:${lineNumber}`];
    })
    .sort();
}
const missedOptimizations = (lines: string[]) => lines.filter(line => line.startsWith("aot: missed"));

const buildTimeout = 300_000;
const interpretedOutput = { stdout: "false\ntrue\ntrue\ntrue\nstring string\n", stderr: "", exitCode: 0, signal: null };
const interpreted = [
  "a WebAssembly function runs in the interpreter: it uses exceptions at partly.wasm:1",
  "a WebAssembly function runs in the interpreter: it uses tail calls at partly.wasm:1",
  "the WebAssembly module runs in the interpreter: it is not valid at broken.wasm:1",
  expect.stringMatching(/^this regular expression runs in the interpreter \(reason \d+\) at interpreted\.ts:6$/),
];

describe.concurrent("code that runs in the interpreter", () => {
  test(
    "gets a warning in every build: a WebAssembly module, one of its functions, a regular expression built at run time",
    () =>
      slot(async () => {
        const { lines, ran } = await build("interpreted.ts");
        expect(interpreterWarnings(lines)).toEqual(interpreted);
        expect(missedOptimizations(lines)).toEqual([]);
        expect(ran).toEqual(interpretedOutput);
      }),
    buildTimeout,
  );

  test(
    "is not listed by --explain=missed-optimizations",
    () =>
      slot(async () => {
        const { lines } = await build("interpreted.ts", "--explain=missed-optimizations");
        expect(interpreterWarnings(lines)).toEqual(interpreted);
        expect(missedOptimizations(lines)).not.toBeEmpty();
        expect(
          missedOptimizations(lines).filter(line => /reg-?exp|regular expression|wasm|WebAssembly/i.test(line)),
        ).toEqual([]);
      }),
    buildTimeout,
  );

  test(
    "the warning shows the limit that a pattern exceeded",
    () =>
      slot(async () => {
        const { lines, ran } = await build("interpreted.ts", "--aot-limit=RegExpPatternLengthWithCode:4");
        const atLine = (line: number) =>
          interpreterWarnings(lines).filter(
            warning => warning.startsWith("this regular expression") && warning.endsWith(` at interpreted.ts:${line}`),
          );
        expect(atLine(4)).not.toBeEmpty();
        for (const warning of atLine(4)) expect(warning).toContain("; limit RegExpPatternLengthWithCode (");
        expect([...atLine(5), ...atLine(7)]).toEqual([]);
        expect(ran).toEqual(interpretedOutput);
      }),
    buildTimeout,
  );

  test(
    "a compiled regular expression or WebAssembly module gets no warning",
    () =>
      slot(async () => {
        const { lines, ran } = await build("compiled.ts", "--explain=missed-optimizations");
        expect(interpreterWarnings(lines)).toEqual([]);
        expect(ran).toEqual({ stdout: "true true\n42\n", stderr: "", exitCode: 0, signal: null });
      }),
    buildTimeout,
  );
});
