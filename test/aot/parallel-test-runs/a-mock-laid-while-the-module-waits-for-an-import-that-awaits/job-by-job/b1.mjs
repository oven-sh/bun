import { vi } from "bun:test";
vi.mock("./a1.mjs", async original => {
  globalThis.said.push("factory");
  await original();
  globalThis.said.push("original");
  return { v: "ma" };
});
await new Promise(done => setTimeout(done, 30));
