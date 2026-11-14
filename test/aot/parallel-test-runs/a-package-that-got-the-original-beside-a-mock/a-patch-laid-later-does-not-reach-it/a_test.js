// A package that imports a file of the program by a statement gets the original beside vi.doMock(). The end of that mock brings nothing back under the file's own key: the file is no package. So mock.module() finds that key empty and patches nothing: the package keeps reading the original.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("./k.js", () => ({ x: "first" })); const k = (await import("./k.js")).x, pkg = await import("pkg"); console.log("SAID", k, pkg.p());
  vi.doUnmock("./k.js"); mock.module("./k.js", () => ({ x: "second" })); console.log("SAID under", (await import("./k.js")).x, pkg.p());
  vi.doUnmock("./k.js"); console.log("SAID ended", pkg.p(), (await import("./k.js")).x);
});
