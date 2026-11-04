// The prototype of a class of the program can be changed under --aot as without it, whether the compiler sees the change in the program's text or not.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

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
    console.log(name + ":", (error as Error).message.replace(/ \\(bun compile.*/, ""));
  }
}
`;
const files = {
  "program.ts": program,
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler", types: [] },
  }),
};

async function run(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: (stdout + stderr).split("\n").filter(Boolean), exitCode };
}

test("bun run --aot prints what bun run prints of every change to a class's prototype", async () => {
  using dir = tempDir("class-prototype-writes", files);
  const plain = await run(String(dir), ["run", "./program.ts"]);
  expect(plain.said).toHaveLength(16);
  expect(await run(String(dir), ["run", "--aot", "./program.ts"])).toEqual({ said: plain.said, exitCode: 0 });
});
