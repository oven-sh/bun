import { test } from "bun:test";
import { write, list } from "./product.mjs";
test("a store is heard", () => {
  const real = JSON.stringify, said = [write("a"), write("b"), list([])];
  JSON.stringify = v => "stored " + v;
  said.push(write("a"));
  JSON.stringify = real;
  said.push(write("a"), list(1));
  console.log("SAID " + said.join(" | "));
});
