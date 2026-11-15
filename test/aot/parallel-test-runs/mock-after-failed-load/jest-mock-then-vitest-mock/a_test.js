// As ../patching-mock-then-vitest-mock, by jest.mock().
import { test, vi, mock, jest } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const made = word => () => { console.log("SAID factory " + word + " runs"); return { x: word }; };
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  jest.mock("./k.js", made("first"));
  vi.doMock("./k.js", made("second"));
  console.log("SAID seen", (await import("./later.js")).seen);
  console.log("SAID k", (await import("./k.js")).x);
});
