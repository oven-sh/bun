import { test, mock } from "bun:test";
const look = () => { try { return String(require("./by-name.mjs").rates.rate); } catch (e) { return e.name; } };
test("t", () => {
  const first = look();
  mock.module("./rates.cjs", () => ({ rate: "the rate of the mock", show() { return "shown by the mock"; } }));
  console.log(first, "|", look());
});
