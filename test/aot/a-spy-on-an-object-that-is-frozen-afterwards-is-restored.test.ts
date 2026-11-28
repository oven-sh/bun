import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A key that only a method assigns has a place in every instance of the class, and a spy on that key goes into the place.
// Object.freeze() locks the place, and restoring the spy has to empty it again.
const testFile = `
import { spyOn, test } from "bun:test";
class Plain { method(): string { return "original"; } }
class Base { hook(): string { return "original"; } }
class Derived extends Base {
  enable(): void { (this as any).hook = () => "enabled"; }
}
class Later {
  enable(): void { (this as any).hook = () => "enabled"; }
}
test("a spy", () => {
  const seen: unknown[] = [];
  for (const [make, key] of [[() => new Plain(), "method"], [() => new Derived(), "hook"], [() => new Later(), "hook"]] as const) {
    const object: any = make();
    const spy = spyOn(object, key);
    Object.freeze(object);
    spy.mockRestore();
    seen.push([typeof object[key] === "function" ? object[key]() : typeof object[key], Object.hasOwn(object, key), Object.isFrozen(object)]);
  }
  console.error("SEEN " + JSON.stringify(seen));
});
`;

test("a spy on an object that is frozen afterwards is restored", async () => {
  using dir = tempDir("aot-spy-on-a-frozen-object", { "a.test.ts": testFile });
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toEqual({
    seen: [`SEEN [["original",false,true],["original",false,true],["undefined",false,true]]`],
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
});
