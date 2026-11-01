import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// A test run asks of every call which built-in object it may answer, and follows what the function behind it returns.
// That way is as long as the program makes it.
const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, i) => row(i)).join("\n");
const programs: Record<string, string> = {
  "each function returns a call of the one before, with calls as operands": `function f0(a) { return a; }
function f1(a) { return a + 1; }
${rows(6_000, i => `function f${i + 2}(a) { return f${i + 1}(f${i}(a), f${Math.max(i - 5, 0)}(a)); }`)}
export const last = f6001;`,
  "a construction in a construction": `function C(a) { this.a = a; }
const made = ${"new C(".repeat(4_000)}1${")".repeat(4_000)};
export const last = () => made;`,
};

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
    using dir = tempDir("aot-deep-walks", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "program.js": program + "\n",
      "a.test.js": `import { expect, test } from "bun:test";\nimport { last } from "./program.js";\ntest("t", () => expect(typeof last).toBe("function"));\n`,
    });
    // How deep an expression the engine's own parser bears depends on the build: under a sanitizer it refuses the construction.
    const plain = await ended(String(dir));
    expect(plain.signal).toBeNull();
    expect(await ended(String(dir), "--aot")).toEqual(plain);
  },
  600_000,
);
