import { test, vi, mock } from "bun:test";
test("x", async () => {
  const short = v => typeof v === "function" ? "f" + vi.isMockFunction(v) : typeof v === "string" ? (v.includes("/") ? "a path" : v.includes("export") || v.includes("=") || v.includes("{") ? "the text" : v) : typeof v === "object" && v ? "{" + Object.keys(v).join() + "}" : String(v);
  const keys = v => Object.keys(v).sort().map(k => k + "=" + short(v[k])).join(",");
  const word = p => Promise.resolve(p).then(keys, e => e.name + ":" + e.code);
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  console.log(await word(import("./part.mjs", { with: { type: "file" } })), "&", await word(import("./part.mjs")), "&", await word(import("./part.mjs", { with: { type: "file" } })), globalThis.ran);
});
