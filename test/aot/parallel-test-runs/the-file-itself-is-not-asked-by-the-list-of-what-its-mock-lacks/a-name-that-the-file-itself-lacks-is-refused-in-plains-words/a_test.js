import { test, vi } from "bun:test";
const tried = async load => { try { return (await load()).look(); } catch (error) { return error.name + " " + String(error.message).replaceAll(",", ";"); } };
test("names", async () => {
  vi.doMock("pack/shapes.mjs", () => ({ round: 100 }));
  console.log("SAID", Object.keys(await import("pack/shapes.mjs")).join());
  console.log("SAID", await tried(() => import("./whole.mjs")));
  console.log("SAID", await tried(() => import("./again.mjs")));
});
