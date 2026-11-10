import { test, vi } from "bun:test";
import { look } from "./user.mjs";
vi.mock("pack", { spy: true });
test("a", async () => {
  const said = async make => { try { return await make(); } catch (error) { return error.name; } };
  console.log("SAID spied", await said(() => look()), globalThis.runs);
  console.log("SAID actual", await said(async () => { const actual = await vi.importActual("pack"); return [typeof actual.box.f.mock, actual.run()].join(" "); }), globalThis.runs);
  console.log("SAID again", await said(async () => (await import("./user.mjs")).look()), globalThis.runs);
});
