import { test, mock, vi } from "bun:test";
test("barrels are asked again under a mock laid behind their load", async () => {
  const first = await import("./b7.mjs");
  console.log("SAID in front", (it => Object.keys(it).length + " " + it.count + " " + ("count" in it))(first));
  vi.doMock("./store.cjs", () => ({ count: 10 }));
  for (const file of ["./b0.mjs", "./b7.mjs"]) console.log("SAID", file, await import(file).then(it => Object.keys(it).length + " " + it.count + " " + ("count" in it), error => error.name));
});
