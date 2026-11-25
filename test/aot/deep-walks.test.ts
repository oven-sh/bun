import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { test } from "./supported";

// A test run asks of every call which built-in object it may answer, and follows what the function behind it returns.
// That way is as long as the program makes it.
const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, i) => row(i)).join("\n");
const construction = (depth: number) => `function C(a) { this.a = a; }
const made = ${"new C(".repeat(depth)}1${")".repeat(depth)};
export const last = () => made;`;
const programs: Record<string, string> = {
  "each function returns a call of the one before, with calls as operands": `function f0(a) { return a; }
function f1(a) { return a + 1; }
${rows(6_000, i => `function f${i + 2}(a) { return f${i + 1}(f${i}(a), f${Math.max(i - 5, 0)}(a)); }`)}
export const last = f6001;`,
  "a construction in a construction": construction(4_000),
  "a call in a call": `function f(a) { return a; }
const made = ${"f(".repeat(5_000)}1${")".repeat(5_000)};
export const last = () => made;`,
};
const folderOf = (program: string) =>
  tempDir("aot-deep-walks", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "program.js": program + "\n",
    "a.test.js": `import { expect, test } from "bun:test";\nimport { last } from "./program.js";\ntest("t", () => expect(typeof last).toBe("function"));\n`,
  });

const passed = { passed: "1 pass", exitCode: 0, signal: null };
async function ended(cwd: string, ...flags: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd,
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  return { passed: /^ *\d+ pass$/m.exec(stderr)?.[0].trim(), exitCode, signal: child.signalCode };
}

test.concurrent.each(Object.entries(programs))(
  "%s",
  async (_, program) => {
    using dir = folderOf(program);
    // How deep an expression the engine's own parser bears depends on the build: under a sanitizer it refuses the construction, which the compiler may bear.
    const plain = await ended(String(dir));
    expect(plain.signal).toBeNull();
    const compiled = await ended(String(dir), "--aot");
    expect(compiled).toEqual(compiled.exitCode === 0 ? passed : plain);
  },
  600_000,
);

// The compiler's parser takes 4 MB of stack, so at this depth a level may cost it 381 bytes. The build that ships took 1,072: it had copied what a speculation saves into the
// function that every nested expression goes through, and refused the 4,000 above. The engine's own parser refuses this depth, so there is nothing to compare with.
test.skipIf(isASAN || isDebug)(
  "a construction in a construction, deeper than the engine's own parser bears",
  async () => {
    using dir = folderOf(construction(11_000));
    expect(await ended(String(dir), "--aot")).toEqual(passed);
  },
  600_000,
);
