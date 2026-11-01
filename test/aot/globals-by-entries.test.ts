// A helper of a test file replaces globals by the keys of an object that its callers spell: `withGlobals({ process: undefined }, run)`.
// The build reads those keys through the loop that lists them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const restore = `  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }`;
const change = `before.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      if (stubs[name] === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, { configurable: true, value: stubs[name] });`;

const loops: Record<string, string> = {
  "for (const [name, value] of Object.entries(stubs))": `for (const [name, value] of Object.entries(stubs)) {
      ${change}
    }`,
  "for (const name of Object.keys(stubs))": `for (const name of Object.keys(stubs)) {
      ${change}
    }`,
  "for (const name in stubs)": `for (const name in stubs) {
      ${change}
    }`,
  "Object.entries(stubs).forEach(([name, value]) => ..)": `Object.entries(stubs).forEach(([name, value]) => {
      ${change}
    });`,
  "Object.getOwnPropertyNames(stubs).forEach(name => ..)": `Object.getOwnPropertyNames(stubs).forEach(name => {
      ${change}
    });`,
};

const forms: [string, string, string[]][] = [
  ["as the run is built by itself", "", []],
  ["three layers", "TestRunLayers:3", ["--isolate"]],
];

for (const [spelled, loop] of Object.entries(loops)) {
  for (const [form, words, flags] of forms) {
    test.concurrent(`${spelled}, ${form}`, async () => {
      using dir = tempDir("globals-by-entries", {
        "stubs.test.ts": `import { expect, test } from "bun:test";
function withGlobals(stubs: Record<string, unknown>, run: () => void) {
  const before = new Map<string, PropertyDescriptor | undefined>();
  try {
    ${loop}
    run();
${restore}
}
test("process is taken away", () => {
  withGlobals({ process: undefined }, () => { expect(typeof process).toBe("undefined"); });
  expect(typeof process).toBe("object");
});
test("process is replaced", () => {
  withGlobals({ process: { versions: { node: "22.0.0" } } }, () => { expect(process.versions.node).toBe("22.0.0"); });
  expect(process.versions.bun).toBe(Bun.version);
});
test("Map is replaced", () => {
  const stubs = { Map: class Fake {} };
  const real = Map;
  withGlobals(stubs, () => { expect(Map.name).toBe("Fake"); });
  expect(Map).toBe(real);
});
`,
      });
      await using run = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", ...flags],
        env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
      expect(stderr.split("\n").filter(line => /^(error|TypeError)\b/.test(line))).toEqual([]);
      expect(stderr).toContain(" 3 pass");
      expect(exitCode).toBe(0);
    });
  }
}
