import { test } from "bun:test";
import { Readable } from "node:stream";

test("a readable asks the accessor that a test has laid under a name made at run time", () => {
  new Readable();
  const name = ["__", "proto", "__"].join(process.argv.length > 100 ? "-" : "");
  const real = Object.getOwnPropertyDescriptor(Object.prototype, name)!;
  let asked = 0;
  const said: string[] = [];
  try {
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      get() {
        asked++;
        return real.get!.call(this);
      },
      set: real.set,
    });
    said.push("laid");
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
  const before = asked;
  new Readable();
  const behindOne = asked - before;
  Readable.from(["made", "up"]);
  const behindTwo = asked - before;
  Object.defineProperty(Object.prototype, name, real);
  console.log("the accessor was", said.join(), "and asked:", behindOne, behindTwo);
});
