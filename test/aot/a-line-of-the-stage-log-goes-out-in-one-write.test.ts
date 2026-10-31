// Bun and the engine write to one descriptor under no common lock: a line that goes out in pieces can have another line in its middle.
import { dlopen, ptr } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { closeSync, readSync } from "node:fs";
import { buildEnvironment, withThreads } from "./harness/flags";
import { test } from "./supported";

// A read from a pipe in packet mode answers with what one write wrote.
function openPipeThatKeepsWritesApart() {
  const packetMode = 0o40000;
  for (const library of ["libc.so.6", "libc.musl-x86_64.so.1", "libc.musl-aarch64.so.1"]) {
    try {
      const libc = dlopen(library, { pipe2: { args: ["ptr", "i32"], returns: "i32" } });
      const ends = new Int32Array(2);
      if (libc.symbols.pipe2(ptr(ends), packetMode) === 0) return { read: ends[0], write: ends[1] };
    } catch {}
  }
  throw new Error("no pipe in packet mode");
}

test.skipIf(!isLinux)("the lines that tools read are one write each", async () => {
  using dir = tempDir("aot-a-line-is-one-write", {
    "program.js": `function double(value) { return value * 2; }\nconsole.log(double(21));\n`,
  });
  const pipe = openPipeThatKeepsWritesApart();
  const build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", withThreads(4), "program.js", "--outfile", "program"],
    cwd: String(dir),
    env: { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: pipe.write,
  });
  closeSync(pipe.write);
  const writes: string[] = [];
  const buffer = Buffer.alloc(65536);
  for (let length; (length = readSync(pipe.read, buffer)) > 0;) writes.push(buffer.toString("utf8", 0, length));
  closeSync(pipe.read);
  expect(await build.exited).toBe(0);

  const ofEngine = /^AOT parallel loops: |^AOT phase times: (?!front end \|)/;
  const begun = writes.filter(text => ofEngine.test(text));
  expect(begun.filter(text => text.startsWith("AOT parallel loops: ")).length).toBeGreaterThan(0);
  expect(begun.filter(text => text.startsWith("AOT phase times: ")).length).toBeGreaterThan(0);
  expect(begun.filter(text => !text.endsWith("\n"))).toEqual([]);
});
