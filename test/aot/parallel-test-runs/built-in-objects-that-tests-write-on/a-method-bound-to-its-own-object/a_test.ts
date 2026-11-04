// A method of `process` is bound to `process`.
import { expect, spyOn, test } from "bun:test";
import { facts } from "./product";

test("what the product sees", () => {
  console.log("before", facts());
  const cwd = process.cwd.bind(process);
  console.log("under", typeof cwd(), typeof process.hrtime.call(process), typeof process.uptime.apply(process, []));
  console.log("behind", facts());
});
