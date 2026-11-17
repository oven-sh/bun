import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test may lay an accessor on `Object.prototype`. It answers a name that a built-in object does not have, with that object as `this`, and can ask it for
// whatever it has.
const head = `import { expect, test } from "bun:test";\n`;
const lay = (asked: string) =>
  `Object.defineProperty(Object.prototype, "madeUp", { configurable: true, get() { return typeof this.${asked}; } });\n`;
const files = {
  "bun-by-its-name.test.js": `${head}${lay("$")}test("Bun is handed to the accessor", () => {
  expect(Bun.madeUp).toBe("function");
});
`,
  "process-by-its-name.test.js": `${head}${lay("allowedNodeEnvironmentFlags.has")}test("process is handed to the accessor", () => {
  expect(process.madeUp).toBe("function");
});
`,
  "a-variable-holds-bun.test.js": `${head}${lay("$")}var kept;
test("Bun is handed to the accessor", () => {
  expect((kept = Bun).madeUp ?? (kept.madeUp = {})).toBe("function");
});
`,
  "a-method-is-called.test.js": `${head}Object.prototype.madeUp = function () { return typeof this.$; };
test("Bun is handed to the method", () => {
  expect(Bun.madeUp()).toBe("function");
});
`,
  "lays-it.js": lay("$"),
  "another-file-lays-it.test.js": `${head}import "./lays-it.js";
test("Bun is handed to the accessor", () => {
  expect(Bun.madeUp).toBe("function");
});
`,
  "the-name-is-read-by-destructuring.test.js": `${head}${lay("$")}test("Bun is handed to the accessor", () => {
  const { madeUp } = Bun;
  expect(madeUp).toBe("function");
});
`,
  "a-helper-is-handed-the-prototype.test.js": `${head}function layOn(target) {
  Object.defineProperty(target, "madeUp", { configurable: true, get() { return typeof this.$; } });
}
layOn(Object.prototype);
test("Bun is handed to the accessor", () => {
  expect(Bun.madeUp).toBe("function");
});
`,
  "the-key-is-put-together.test.js": `${head}${lay("$")}test("Bun is handed to the accessor", () => {
  expect(Bun["made" + "Up"]).toBe("function");
});
`,
  "the-key-is-in-a-constant.test.js": `${head}${lay("$")}const key = "madeUp";
test("Bun is handed to the accessor", () => {
  expect(Bun[key]).toBe("function");
});
`,
  "a-store-finds-a-setter.test.js": `${head}let seen;
Object.defineProperty(Object.prototype, "madeUp", { configurable: true, set(value) { seen = typeof this.$; } });
test("Bun is handed to the setter", () => {
  Bun.madeUp = 1;
  expect(seen).toBe("function");
});
`,
};
const tests = Object.keys(files).filter(name => name.endsWith(".test.js"));

test.each(tests.flatMap(name => [[name], [name, "--aot"]]))(
  "%s %s",
  async (name, ...flags) => {
    using dir = tempDir("aot-an-accessor-laid-on-object-prototype", files);
    const tested = await run([bunExe(), "test", ...flags, "./" + name], String(dir), bunEnv);
    expect(tested.stderr).toContain("1 pass");
    expect(tested.exitCode).toBe(0);
  },
  60_000,
);
