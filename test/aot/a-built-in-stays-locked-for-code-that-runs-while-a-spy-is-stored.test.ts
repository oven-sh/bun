// A spy is stored through the lock of the built-ins: while that lock is open a write to a locked built-in goes through, whoever makes it. `process.env` takes a store under an index with a hook of
// its own, which makes a string of the value, and `toString` of the spy is code of the test. With a function above `process.env` under that index, spyOn opened the lock around the hook, and the
// test wrote on `Array.prototype` from inside it. The lock now opens only for an object that is locked, and nothing locks an object whose store runs code.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("what converts the spy for process.env writes on Array.prototype only where the test may", async () => {
  using dir = tempDir("aot-spy-store-keeps-the-lock", {
    "one.test.js": `
      import { spyOn, test } from "bun:test";
      test("it", () => {
        const write = () => {
          try {
            return Reflect.defineProperty(Array.prototype, 7, { value: 7, configurable: true });
          } catch {
            return "refused";
          }
        };
        const outside = write();
        let inside = "never asked";
        const { toString } = Function.prototype;
        Object.setPrototypeOf(process.env, { 0() {} });
        Function.prototype.toString = function () {
          inside = write();
          return toString.call(this);
        };
        try {
          spyOn(process.env, 0);
        } finally {
          Function.prototype.toString = toString;
          Object.setPrototypeOf(process.env, Object.prototype);
          delete process.env[0];
        }
        console.error("SEEN " + JSON.stringify([outside, inside]));
      });`,
  });
  const seenWith = async (...flags: string[]) => {
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return { seen: stderr.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  // Nothing is locked in a plain run. Compiled, the write is refused outside the store, so the run is locked, and inside the store as well.
  expect(await seenWith()).toEqual({ seen: [`SEEN [true,true]`], exitCode: 0 });
  expect(await seenWith("--aot")).toEqual({ seen: [`SEEN ["refused","refused"]`], exitCode: 0 });
});
