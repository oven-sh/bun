// A test file stores another class under Date, constructs one that nothing reads, and puts the real one back.
import { test } from "bun:test";
const made = [];
const real = Date;
globalThis.Date = class { constructor() { made.push("Date"); } };
const unused = new Date();
globalThis.Date = real;
test("a constructor that the file has replaced runs", () => {
  console.log(made.join(","));
});
