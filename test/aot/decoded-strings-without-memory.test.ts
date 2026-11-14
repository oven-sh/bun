// Runs alone: each program is started with little memory and fills it.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Compiled code decodes and encodes by functions of its own. Where memory does not suffice for the text, plain's function runs and throws, in the sizes round the one that is decoded on the stack too.
const program = `const which = process.argv[2], size = 40 * 1024 * 1024;
const decoder = new TextDecoder(), fatal = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder();
function bytes(changes) { const made = new Uint8Array(size).fill(97); for (const [at, byte] of changes) made[(at + size) % size] = byte; return made; }
const held = [];
function full(value) { for (const step of [64, 16]) try { for (;;) held.push(new Uint8Array(step << 20)); } catch {} return value; }
const flat = text => { text.charCodeAt(3); return text; };
function decoded(b) { let n = 0; for (let i = 0; i < 1 + (b.length & 0); i++) n += decoder.decode(b).length; return n; }
function decodedStrictly(b) { let n = 0; for (let i = 0; i < 1 + (b.length & 0); i++) n += fatal.decode(b).length; return n; }
function encoded(s) { let n = 0; for (let i = 0; i < 1 + (s.length & 0); i++) n += encoder.encode(s).length; return n; }
function around() { let out = ""; for (const n of [0, 1, 255, 256, 257, 512]) for (const last of [97, 0xff, 0xc3]) { const b = new Uint8Array(n).fill(98); if (n) b[n - 1] = last; if (n > 3 && last === 0xc3) { b[0] = 0xc3; b[1] = 0xa9; b[n - 1] = 99; } out += decoder.decode(b).length + ":" + decoder.decode(b).charCodeAt(n >> 1) + " "; try { out += fatal.decode(b).length + " "; } catch (e) { out += e.name + " "; } } return out; }
const forms = {
  ascii: () => decoded(full(bytes([]))),
  strict: () => decodedStrictly(full(bytes([]))),
  marked: () => decoded(full(bytes([[0, 0xef], [1, 0xbb], [2, 0xbf]]))),
  wide: () => decoded(full(bytes([[-2, 0xc3], [-1, 0xa9]]))),
  invalid: () => decodedStrictly(full(bytes([[9, 0xff]]))),
  text: () => encoded(full(flat("a".repeat(size)))),
  rope: () => { let s = "ab".repeat(1 << 20); while (s.length < size) s = s + s; return encoded(full(s)); },
  sizes: () => around() + full("") + around(),
};
let result;
try { result = forms[which](); } catch (e) { result = "caught " + e.name + " " + e.message + " " + e.code; }
console.log(which, result);
`;

const withLittleMemory = ["/bin/sh", "-c", `ulimit -d 1500000; exec "$@"`, "--"];

describe.skipIf(!isLinux || isASAN || isDebug)("decoded texts that do not fit", () => {
  test("a compiled program catches what plain Bun catches", async () => {
    using dir = tempDir("aot-decoded-texts", { "texts.mjs": program });
    const executable = join(String(dir), "texts");
    await using built = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./texts.mjs", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [problems, builtWith] = await Promise.all([built.stderr.text(), built.exited]);
    expect({ errors: problems.split("\n").filter(line => line.startsWith("error")), builtWith }).toEqual({
      errors: [],
      builtWith: 0,
    });

    const run = async (cmd: string[]) => {
      await using started = Bun.spawn({
        cmd: [...withLittleMemory, ...cmd],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout] = await Promise.all([started.stdout.text(), started.exited]);
      return stdout;
    };
    const shapes = [...program.matchAll(/^  (\w+): \(\) =>/gm)].map(shape => shape[1]);
    const [compiled, plain] = await Promise.all([
      Promise.all(shapes.map(shape => run([executable, shape]))),
      Promise.all(shapes.map(shape => run([bunExe(), "texts.mjs", shape]))),
    ]);
    expect(compiled).toEqual(plain);
  });
});
