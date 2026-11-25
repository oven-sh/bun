import { test, vi } from "bun:test";
import { byHelper } from "./helper.mjs";
const byTest = name => { try { return require(name).shade; } catch (error) { return "threw " + error.name; } };
test("who gets what while the factory of the dye has not settled", async () => {
  let open, calls = 0;
  const gate = new Promise(done => (open = done));
  vi.doMock("./dye.mjs", async () => { calls++; await gate; return { shade: "mocked dye" }; });
  console.log("the answer 1:", byHelper("./vat.mjs"));
  console.log("the answer 2:", byHelper("./skein.mjs"));
  open();
  console.log("the factory was called", calls, "times");
});
