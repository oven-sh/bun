// A sloppy function stores under a computed key into a member of its `this`, which nobody knows. The rest of the program uses Date, Promise and TypeError.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { test } from "./supported";

const uses = `console.log(new Date(0).getTime(), typeof Promise.resolve(1).then, new TypeError("x").message);\n`;
const store = `function define(target, name) {
  Object.defineProperty(exports, name, { set(value) { this[target][name] = value; }, configurable: true });
}
define(process.argv[2] ?? "inner", process.argv[3] ?? "field");
exports.inner = {};
exports.field = 1;
`;

async function numbersOf(program: string) {
  using dir = tempDir("aot-explain-globals", { "main.cjs": program });
  const { stdout } = await run([bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.cjs"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return parseExplainLines(stdout).numbers;
}

// Today: the store may hit the global object under every name, so each global that is no locked one is looked up when the program runs.
test.todo(
  "the store makes no call of a global a call of a callee nobody knows",
  async () => {
    const [alone, beside, storeAlone] = await Promise.all([numbersOf(uses), numbersOf(store + uses), numbersOf(store)]);
    expect(beside.calls.unknown - storeAlone.calls.unknown).toBe(alone.calls.unknown);
  },
  60_000,
);
