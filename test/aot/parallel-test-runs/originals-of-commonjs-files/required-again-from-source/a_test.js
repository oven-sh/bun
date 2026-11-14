import { afterAll, afterEach, beforeEach, jest, mock, spyOn, test, vi } from "bun:test";
const lines = [];
const told = async ask => { try { return String(await ask()); } catch (error) { return "threw " + error.name + " " + error.message; } };
const look = async step => {
  let held;
  try { held = { serve: require("./kitchen.cjs").serve, kettle: require("./kettle.cjs") }; } catch (error) { lines.push(step + " the load threw " + error.name); return; }
  console.log("SAID", step, await told(() => held.serve()), await told(() => held.kettle.boil()), await told(() => held.kettle.brand), globalThis.boiled ?? 0);
};
vi.mock("./kettle.cjs", async importOriginal => ({ ...(await importOriginal()), boil: vi.fn(() => "mock") }));
afterEach(() => { jest.resetModules(); });
test("first", async () => { await look("1"); });
test("second", async () => { await look("2"); });
