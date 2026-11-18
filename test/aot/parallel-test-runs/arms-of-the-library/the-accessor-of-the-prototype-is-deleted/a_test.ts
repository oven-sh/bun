import { test } from "bun:test";
import { Readable } from "node:stream";

test("a readable is born where a test has deleted Object.prototype's accessor", () => {
  new Readable();
  const real = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!;
  const said: string[] = [];
  delete (Object.prototype as any).__proto__;
  try {
    new Readable();
    said.push("born");
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
  Object.defineProperty(Object.prototype, "__proto__", real);
  new Readable();
  said.push("born behind");
  console.log("with the accessor deleted:", said.join(", "));
});
