// Under --aot the prototype of a class of the program is fixed, but for the changes that the compiler sees in the program's text.
// `--aot-type-errors=log` must name every change that the default mode refuses: when the program ran in place (`bun run --aot`, `bun test --aot`) it neither refused nor reported them, so a suite that
// failed by default passed in log mode with an empty log.
import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";

const program = `
class Store {
  closed = 0;
  close(): number {
    return ++this.closed;
  }
  open(): number {
    return --this.closed;
  }
}
const anything: any = Reflect.get(Store, "prototype");
const attempts: [string, () => unknown][] = [
  ["assignment", () => (anything.extra = 1)],
  ["assignment by a computed key", () => (anything[["ali", "ased"].join("")] = 1)],
  ["replace a method", () => (anything.close = () => 7)],
  ["Object.defineProperty, a new name", () => Object.defineProperty(anything, "defined", { value: 1, configurable: true })],
  ["Object.defineProperty, a new symbol", () => Object.defineProperty(anything, Symbol.iterator, { value: 1, configurable: true })],
  ["Object.defineProperty, a method", () => Object.defineProperty(anything, "open", { value: () => 8 })],
  ["Object.defineProperties", () => Object.defineProperties(anything, { several: { value: 1 } })],
  ["Reflect.defineProperty", () => Reflect.defineProperty(anything, "reflected", { value: 1 })],
  ["Reflect.set", () => Reflect.set(anything, "set", 1)],
  ["Object.assign", () => Object.assign(anything, { assigned: 1 })],
  ["delete", () => delete anything.open],
  ["Object.setPrototypeOf", () => Object.setPrototypeOf(anything, { inherited: 1 })],
  ["assignment, seen", () => ((Seen.prototype as any).extra = 1)],
  ["Object.defineProperty, a new name, seen", () => Object.defineProperty(Seen.prototype, "defined", { value: 1, configurable: true })],
  ["Object.assign, seen", () => Object.assign(Seen.prototype, { assigned: 1 })],
  ["replace a method, seen", () => ((Seen.prototype as any).close = () => 7)],
];
class Seen {
  closed = 0;
  close(): number {
    return ++this.closed;
  }
}
for (const [name, attempt] of attempts) {
  try {
    const result = attempt();
    console.log(name + ":", typeof result === "object" || typeof result === "function" ? "done" : String(result));
  } catch (error) {
    console.log(name + ":", (error as Error).message.replace(/ \\(bun --aot.*/, ""));
  }
}
`;
const files = {
  "program.ts": program,
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler", types: [] } }),
};
const refusedLines = [13, 14, 16, 17, 19, 20, 21, 22, 24];

async function run(cwd: string, args: string[]) {
  await using ran = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  const lines = (stdout + stderr).split("\n").filter(Boolean);
  return {
    said: lines.filter(line => !line.startsWith("[aot]")),
    records: [...new Set(lines.filter(line => line.startsWith("[aot] type-error")).map(line => line.split(" ").slice(3, 5).join(" ").replace(/:\d+$/, "")))],
    exitCode,
  };
}

test("bun run --aot --aot-type-errors=log reports every change to a class's prototype that the default mode refuses", async () => {
  using dir = tempDir("class-prototype-writes", files);
  const plain = await run(String(dir), ["run", "./program.ts"]);
  const logged = await run(String(dir), ["run", "--aot", "--aot-type-errors=log", "./program.ts"]);
  expect(logged.said).toEqual(plain.said);
  expect(logged.records.sort()).toEqual(refusedLines.map(line => `class-prototype-write program.ts:${line}`).sort());
  expect(logged.exitCode).toBe(0);
});

test("bun run --aot names the class in what it refuses, before the class has an instance", async () => {
  using dir = tempDir("class-prototype-writes", files);
  const { said } = await run(String(dir), ["run", "--aot", "./program.ts"]);
  expect(said).toContain("Object.defineProperty, a new symbol: Cannot change [Symbol.iterator] of Store.prototype: classes are fixed in a program compiled with --aot");
  expect(said).toContain("replace a method: done");
  expect(said.slice(-4)).toEqual(["assignment, seen: 1", "Object.defineProperty, a new name, seen: done", "Object.assign, seen: done", "replace a method, seen: done"]);
  expect(said.join("\n")).not.toContain("built-ins are locked");
});
