import { test, mock, vi } from "bun:test";
test("barrels are asked again under a mock laid behind their load", async () => {
  const first = await import("./b1.mjs");
  vi.doMock("./store.mjs", () => ({ count: 10 }));
  for (const file of ["./b0.mjs", "./b1.mjs"]) console.log("SAID", file, await import(file).then(it => Object.keys(it).length + " " + it.count + " " + ("count" in it), error => error.name));
});
