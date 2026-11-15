import { test, vi } from "bun:test";
const said = it => Object.keys(it).sort().map(key => key + "=" + it[key]).join();
test("the panel", async () => {
  vi.doMock("./counter.mjs", async original => ({ ...(await original()), counter: "mocked" }));
  vi.doMock("./gauge.mjs", () => ({ gauge: "mocked" }));
  console.log("SAID panel", said(await import("./panel.mjs")));
  console.log("SAID reader", (await import("./reader.mjs")).read());
});
