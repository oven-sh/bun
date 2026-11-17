import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const product = `
const isObject = v => typeof v === "object" && v !== null && !Array.isArray(v);
function isPlainObject(o) {
  if (isObject(o) === false) return false;
  const made = o.constructor;
  if (made === undefined) return true;
  if (typeof made !== "function") return true;
  return isObject(made.prototype) !== false;
}
const tools = { isPlainObject };
export function makeCheck(shape, texts) {
  const names = Object.keys(shape);
  const patterns = texts.map(text => new RegExp(text));
  return payload => {
    if (!(0, tools.isPlainObject)(payload.value)) return;
    const unknown = [];
    for (const key of Object.keys(payload.value)) {
      if (names.includes(key)) continue;
      if (patterns.some(pattern => pattern.test(key))) continue;
      unknown.push(key);
    }
    if (unknown.length) payload.issues.push(unknown.join());
  };
}
export const countOf = (value, patterns) => {
  let count = 0;
  for (const key of Object.keys(value)) {
    if (patterns.some(pattern => pattern.test(key))) continue;
    count++;
  }
  return count;
};
`;
const tests = `
import { expect, test } from "bun:test";
import { countOf, makeCheck } from "./product.mjs";
test("a callback that answers ends the turn of a loop", () => {
  const check = makeCheck({ a: 1 }, ["^b", "c$"]);
  const payload = { value: { a: 1, b: 2, d: 3, xc: 4, e: 5 }, issues: [] };
  check(payload);
  check({ value: 3, issues: payload.issues });
  check({ value: { f: 1 }, issues: payload.issues });
  expect(payload.issues).toEqual(["d,e", "f"]);
  expect([countOf({ a: 1, b: 2 }, [/a/]), countOf({}, []), countOf({ a: 1, c: 2 }, [])]).toEqual([1, 0, 2]);
});
`;

for (const compiled of [false, true]) {
  test.concurrent(`a callback that answers ends the turn of a loop${compiled ? ", compiled" : ""}`, async () => {
    using dir = tempDir("callback-ends-turn", { "product.mjs": product, "product.test.mjs": tests });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...(compiled ? ["--aot"] : []), "./product.test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
}
