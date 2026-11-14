import { test, vi } from "bun:test";
const bring = async label => { for (const path of ["barrel", "pkg"]) console.log("SAID", label, path, await (path === "pkg" ? import("pkg") : import("./barrel.mjs")).then(ns => ns.value, error => "!" + error.message), globalThis.cjsRuns); };
test("a", async () => {
  await bring("first");
  vi.doMock("pkg", () => ({ value: "mock" }));
  await bring("laid");
  vi.doUnmock("pkg");
  await bring("lifted");
});
