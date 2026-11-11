import { test, vi } from "bun:test";
const ask = async () => { try { return typeof (await import("pkg")).go; } catch (error) { return error.name; } };
const now = () => { try { return typeof require("pkg").go; } catch (error) { return error.name; } };
test("a", async () => {
  const said = [];
  vi.doMock("pkg");
  said.push(await ask());
  said.push(now());
  console.log("SAID a", said.join(), globalThis.bodies);
  // The runner hears of the rejection when the jobs have run out. The test lasts until then, so that it is this test that fails.
  await new Promise(done => setTimeout(done, 5));
});
test("b", () => { console.log("SAID b runs"); });
