import { test, vi } from "bun:test";
test("x", async () => {
  let open;
  globalThis.gate = new Promise(resolve => { open = resolve; });
  const began = new Promise(resolve => { globalThis.began = resolve; });
  const keys = all => Object.keys(all).sort().map(key => key + "=" + (typeof all[key] === "function" ? "mocked " + vi.isMockFunction(all[key]) : String(all[key]).includes("/") ? "a path" : String(all[key]))).join(",");
  const first = import("./part.mjs");
  await began;
  vi.doMock("./part.mjs");
  const asFile = await import("./part.mjs", { with: { type: "file" } });
  open();
  console.log(keys(asFile), "&", keys(await first), "&", keys(await import("./part.mjs")), globalThis.ran);
}, 3000);
