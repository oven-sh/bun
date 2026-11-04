// `$processBindingConstants` and the objects of numbers under it (ProcessBindingConstants.cpp) are what node:os, node:fs,
// node:crypto and node:zlib answer as `constants`, and what node:zlib reads its own constants from. A read under a name that
// is only known at run time finds a number there, and a number is no member of any built-in: the read opens nothing. Neither
// does what node:zlib does with the constants as it loads, nor a read beside the modules that also read them (node:util).
import { expect, test as testAnywhere } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { test } from "./supported";

// One check of a program takes longer than the five seconds of bun:test, also beside another file of this folder.
raiseDefaultTimeout(120_000);

const programs = {
  "importing node:zlib": `import "node:zlib"; console.log(1);`,
  "crc32 of node:zlib": `import { crc32 } from "node:zlib"; console.log(crc32("hello"));`,
  "zlib.constants under a name of the command line": `import zlib from "node:zlib"; console.log(zlib.constants[process.argv[2] ?? "Z_OK"]);`,
  "os.constants.signals under a name of the command line": `import os from "node:os"; console.log(os.constants.signals[process.argv[2] ?? "SIGTERM"]);`,
  "os.constants.errno under a name of the command line, beside node:util": `import "node:util"; import os from "node:os"; console.log(os.constants.errno[process.argv[2] ?? "ENOENT"]);`,
  "util.convertProcessSignalToExitCode of a name of the command line": `import util from "node:util"; console.log(util.convertProcessSignalToExitCode(process.argv[2] ?? "SIGTERM"));`,
  "fs.constants under a name of the command line": `import fs from "node:fs"; console.log(fs.constants[process.argv[2] ?? "O_RDONLY"]);`,
  "crypto.constants under a name of the command line": `import crypto from "node:crypto"; console.log(crypto.constants[process.argv[2] ?? "RSA_PKCS1_PADDING"]);`,
};

async function report(text: string) {
  using dir = tempDir("aot-process-binding-constants", { "main.ts": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return (stdout + stderr).split("\n").filter(line => line.startsWith("aot: trim: "));
}

for (const [what, text] of Object.entries(programs))
  test.concurrent(`${what} opens nothing`, async () => {
    const lines = await report(text);
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    expect(lines).toContain("aot: trim: locales: none");
    // node:zlib reads the constants through the private global, so nothing of these programs names process.binding.
    expect(lines).toContain("aot: trim: removed process.binding: unused");
  });

// What the rows of src/codegen/builtins/host/runtime-dependencies.builtins.ts say of the objects. ProcessBindingConstants.cpp
// keeps to it: a new name with another kind of value goes into both.
testAnywhere("the objects hold what the table of built-ins says of them", () => {
  const constants = process.binding("constants");
  const shape = (object: object, exceptions: Record<string, string> = {}) => ({
    prototype: Object.getPrototypeOf(object),
    ...Object.fromEntries(Object.entries(object).map(([name, value]) => [name, exceptions[name] ?? typeof value])),
  });
  const numbers = (object: object) => Object.fromEntries(Object.keys(object).map(name => [name, "number"]));
  expect(shape(constants)).toEqual({
    prototype: null,
    os: "object",
    fs: "object",
    crypto: "object",
    zlib: "object",
    trace: "object",
  });
  expect(shape(constants.os)).toEqual({
    prototype: null,
    UV_UDP_REUSEADDR: "number",
    dlopen: "object",
    errno: "object",
    signals: "object",
    priority: "object",
  });
  // dlopen is empty on Windows, where there is no RTLD_*.
  for (const object of [
    constants.os.errno,
    constants.os.signals,
    constants.os.priority,
    constants.fs,
    constants.zlib,
    constants.trace,
  ]) {
    expect(Object.keys(object).length).toBeGreaterThan(0);
  }
  for (const object of [
    constants.os.dlopen,
    constants.os.errno,
    constants.os.signals,
    constants.os.priority,
    constants.fs,
    constants.zlib,
    constants.trace,
  ]) {
    expect(shape(object)).toEqual({ prototype: null, ...numbers(object) });
  }
  expect(shape(constants.crypto)).toEqual({
    prototype: null,
    ...numbers(constants.crypto),
    defaultCoreCipherList: "string",
    defaultCipherList: "string",
  });
});
