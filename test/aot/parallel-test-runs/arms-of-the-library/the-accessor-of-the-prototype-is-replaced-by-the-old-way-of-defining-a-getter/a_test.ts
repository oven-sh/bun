import { test } from "bun:test";
import { Readable } from "node:stream";

test("a readable asks the getter that a test has laid by __defineGetter__()", () => {
  new Readable();
  const real = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
  let asked = 0;
  (Object.prototype as any).__defineGetter__("__proto__", function (this: object) {
    asked++;
    return real.get!.call(this);
  });
  const before = asked;
  new Readable();
  const behindOne = asked - before;
  class Heir extends Readable {}
  new Heir();
  const behindTwo = asked - before;
  Object.defineProperty(Object.prototype, "__proto__", real);
  console.log("the getter was asked:", behindOne, behindTwo);
});
