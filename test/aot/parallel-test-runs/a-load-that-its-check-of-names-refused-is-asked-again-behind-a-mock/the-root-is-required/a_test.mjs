import { test, vi } from "bun:test";
test("the load is asked again", async () => {
  const ask = () => { try { return "loaded " + JSON.stringify(require("./desk.mjs")); } catch (error) { return (error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""))(error); } };
  console.log("SAID", ask());
  vi.doMock("./lamp.mjs", () => ({ height: "mock" }));
  console.log("SAID", ask());
});
