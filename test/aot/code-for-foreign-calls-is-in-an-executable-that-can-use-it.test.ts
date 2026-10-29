import { JSCallback } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { findImage, imageFlag, imageHeader } from "./cli/compiled-image";
import { built, spawned } from "./harness/commands";
import { copyWithoutDebugInformation, withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const printed = (expression: string) =>
  `try { console.log(${expression}); } catch (error) { console.log(error.name); }\n`;
const text = `(process.argv[2] ?? "1 + 1")`;
const waysOfTheHost = `import Module from "node:module";
import vm from "node:vm";
${printed(`vm.runInNewContext(${text})`)}${printed(`new vm.Script(${text}).runInThisContext()`)}${printed(`vm.runInThisContext(${text})`)}${printed(`vm.compileFunction("return " + ${text})()`)}${printed(`typeof new vm.SourceTextModule(${text})`)}const made = new Module("made");
${printed(`(made._compile("module.exports = " + ${text}, "made.js"), made.exports)`)}`;
const files = {
  "hello.js": `console.log("hello");\n`,
  "evaluates.js": printed(`(0, eval)(${text})`),
  "new-context.js": `import vm from "node:vm";\n${printed(`vm.runInNewContext(${text})`)}`,
  "script.js": `import vm from "node:vm";\n${printed(`new vm.Script(${text}).runInThisContext()`)}`,
  "ways-of-the-host.js": waysOfTheHost,
  "synthetic-module.js": `import vm from "node:vm";
let calls = 0;
const box = { value: 1 };
const made = new vm.SyntheticModule(["x"], function () {
  calls++;
  box.value = "changed";
  this.setExport("x", 41 + calls);
});
await made.link(() => {});
await made.evaluate();
console.log(calls, made.namespace.x, box.value, made.status);
`,
  "callback.js": `import { JSCallback } from "bun:ffi";
const callback = new JSCallback(() => 1, { returns: "int", args: [] });
console.log(typeof callback.ptr);
callback.close();
`,
};
const refuses = "--compile-exec-argv=--disallow-code-generation-from-strings";
const named = (name: string) => (isWindows ? name + ".exe" : name);

function callsNativeFunctions() {
  try {
    new JSCallback(() => {}, { returns: "void", args: [] }).close();
    return true;
  } catch {
    return false;
  }
}

function executableSegments(file: Buffer): number[] {
  const sizes: number[] = [];
  const [offset, entrySize, count] = [Number(file.readBigUInt64LE(32)), file.readUInt16LE(54), file.readUInt16LE(56)];
  for (let at = offset; at < offset + count * entrySize; at += entrySize)
    if (file.readUInt32LE(at) === 1 && file.readUInt32LE(at + 4) & 1) sizes.push(Number(file.readBigUInt64LE(at + 40)));
  return sizes;
}

describe.concurrent("code for foreign calls", () => {
  async function make(folder: string, entry: keyof typeof files, ...flags: string[]) {
    const outfile = join(folder, named("out-" + entry.slice(0, -3)));
    const startsFrom = flags.includes("--compile-executable-path") ? [] : withoutDebugInformation;
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, ...startsFrom, entry, "--outfile", outfile],
        folder,
        bunEnv,
      ),
    );
    const file = readFileSync(outfile);
    const image = findImage(file);
    const executableSize = Number(file.readBigUInt64LE(image + imageHeader.executableSize));
    if (isLinux) expect(executableSegments(file)).toContain(executableSize);
    const { stdout, exitCode } = await spawned([outfile], folder, bunEnv);
    return {
      flags: file.readUInt32LE(image + imageHeader.flags),
      size: file.readUInt32LE(image + imageHeader.ffiCodeSize),
      executableSize,
      stdout,
      exitCode,
    };
  }
  const closed = { flags: 0, size: 0, exitCode: 0 };
  const open = imageFlag.admitsUnknownJavaScript | imageFlag.loadsModulesByName;

  test("is in no program that cannot use it", async () => {
    using dir = tempDir("foreign-calls-hello", files);
    expect(await make(String(dir), "hello.js")).toMatchObject({ ...closed, stdout: "hello\n" });
  });

  const inABunThatCallsNativeFunctions = test.skipIf(!callsNativeFunctions());

  inABunThatCallsNativeFunctions("is in a program that names bun:ffi", async () => {
    using dir = tempDir("foreign-calls-named", files);
    const made = await make(String(dir), "callback.js");
    expect(made).toMatchObject({ flags: 0, stdout: "number\n", exitCode: 0 });
    expect(made.size).toBeGreaterThan(0);
  });

  function writeTemplate(folder: string, leftOut: number) {
    const template = join(folder, named("template"));
    const bytes = readFileSync(copyWithoutDebugInformation ?? bunExe());
    const record = bytes.indexOf(Buffer.concat([Buffer.from("BUNAOTLO", "latin1"), Buffer.from([16, 0, 0, 0])]));
    expect(record).toBeGreaterThan(0);
    bytes.writeUInt32LE(bytes.readUInt32LE(record + 12) | leftOut, record + 12);
    writeFileSync(template, bytes, { mode: 0o755 });
    return template;
  }

  inABunThatCallsNativeFunctions(
    "is in a program that evaluates text, unless the executable to start from calls no native function",
    async () => {
      using dir = tempDir("foreign-calls-text", files);
      const folder = String(dir);
      const withCode = await make(folder, "evaluates.js");
      const without = await make(folder, "evaluates.js", "--compile-executable-path", writeTemplate(folder, 1 << 0));
      expect(withCode).toMatchObject({ flags: open, stdout: "2\n", exitCode: 0 });
      expect(withCode.size).toBeGreaterThan(0);
      expect(without).toMatchObject({ flags: open, size: 0, stdout: "2\n", exitCode: 0 });
      expect(withCode.executableSize - without.executableSize).toBeGreaterThanOrEqual(withCode.size);
    },
  );

  (canTrim ? inABunThatCallsNativeFunctions : test.skip)(
    "is in a trimmed executable that names bun:ffi, and in no other",
    async () => {
      using dir = tempDir("foreign-calls-trimmed", files);
      const folder = String(dir);
      const namesIt = await make(folder, "callback.js", "--trim");
      expect(namesIt).toMatchObject({ flags: 0, stdout: "number\n", exitCode: 0 });
      expect(namesIt.size).toBeGreaterThan(0);
      const unnamed = { flags: open, size: 0, stdout: "2\n", exitCode: 0 };
      expect(await make(folder, "evaluates.js", "--trim")).toMatchObject(unnamed);
      expect(await make(folder, "evaluates.js", "--trim-without=Ffi")).toMatchObject(unnamed);
    },
    600_000,
  );

  test("is not in a program that evaluates text where the executable to start from refuses every text", async () => {
    using dir = tempDir("foreign-calls-template-refuses", files);
    const folder = String(dir);
    expect(
      await make(folder, "ways-of-the-host.js", "--compile-executable-path", writeTemplate(folder, 1 << 1)),
    ).toMatchObject({ ...closed, stdout: "EvalError\n".repeat(6) });
  });

  test.each(["evaluates.js", "new-context.js", "script.js"] as const)(
    "is not in %s where every text is refused",
    async entry => {
      using dir = tempDir("foreign-calls-strict", files);
      expect(await make(String(dir), entry, refuses + "=strict")).toMatchObject({ ...closed, stdout: "EvalError\n" });
    },
  );

  test("every way of the host to run a text counts for nothing where every text is refused", async () => {
    using dir = tempDir("foreign-calls-strict-host", files);
    expect(await make(String(dir), "ways-of-the-host.js", refuses + "=strict")).toMatchObject({
      ...closed,
      stdout: "EvalError\n".repeat(6),
    });
  });

  test("a module of node:vm that is made of no text runs where every text is refused", async () => {
    using dir = tempDir("foreign-calls-strict-synthetic", files);
    expect(await make(String(dir), "synthetic-module.js", refuses + "=strict")).toMatchObject({
      ...closed,
      stdout: "1 42 changed evaluated\n",
    });
  });

  test("what the host is handed runs where eval alone is refused", async () => {
    using dir = tempDir("foreign-calls-like-node", files);
    const folder = String(dir);
    expect(await make(folder, "evaluates.js", refuses)).toMatchObject({ ...closed, stdout: "EvalError\n" });
    const made = await make(folder, "ways-of-the-host.js", refuses);
    expect(made).toMatchObject({ flags: open, stdout: "2\n2\n2\n2\nobject\n2\n", exitCode: 0 });
  });
});
