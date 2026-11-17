import { test } from "bun:test";
import { Readable } from "node:stream";

test("a readable asks the accessor that a test has laid in the place of Object.prototype's", () => {
  new Readable();
  const real = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
  let asked = 0;
  Object.defineProperty(Object.prototype, "__proto__", {
    configurable: true,
    get() {
      asked++;
      return real.get!.call(this);
    },
    set: real.set,
  });
  const before = asked;
  new Readable();
  const behindOne = asked - before;
  Readable.from(["made", "up"]);
  const behindTwo = asked - before;
  Object.defineProperty(Object.prototype, "__proto__", real);
  console.log("the accessor was asked:", behindOne, behindTwo);
});
