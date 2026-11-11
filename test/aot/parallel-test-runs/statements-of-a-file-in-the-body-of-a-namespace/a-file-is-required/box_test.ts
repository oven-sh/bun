import { test } from "bun:test";
namespace Box {
  import dep = require("./dep.cjs");
  export function read() { return dep.n; }
}
test("an alias by require inside a namespace", () => {
  let out;
  try { out = Box.read(); } catch (e) { out = (e as Error).name; }
  console.log(String(out));
});
