import { test } from "bun:test";
import Module from "node:module";
import "./src/user.cjs";

const real = Module.createRequire;
Module.createRequire = () => name => ({ describe: () => "replacement got " + name });
const load = Module.createRequire(import.meta.url);
Module.createRequire = real;

test("the replacement answers, not the loader", () => {
  console.log(load("./src/user.cjs").describe(1));
});
