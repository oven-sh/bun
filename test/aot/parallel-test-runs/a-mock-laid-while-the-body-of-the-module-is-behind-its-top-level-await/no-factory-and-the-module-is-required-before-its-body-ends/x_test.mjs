import { test, vi } from "bun:test";
test("x", async () => {
  let open; globalThis.gate = new Promise(r => { open = r; });
  const began = new Promise(r => { globalThis.began = r; });
  const keys = v => Object.keys(v).sort().map(k => k + "=" + (typeof v[k] === "function" ? "mocked " + vi.isMockFunction(v[k]) : String(v[k]))).join(",");
  const ask = () => { try { return keys(require("./part.mjs")); } catch (error) { return error.name + ": " + error.message.replace(/"[^"]*"/, "the file"); } };
  const first = import("./part.mjs"); await began;
  vi.doMock("./part.mjs");
  const early = ask();
  const second = import("./part.mjs");
  open();
  console.log("SAID", early, "&", keys(await first), "&", keys(await second), "&", ask());
});
