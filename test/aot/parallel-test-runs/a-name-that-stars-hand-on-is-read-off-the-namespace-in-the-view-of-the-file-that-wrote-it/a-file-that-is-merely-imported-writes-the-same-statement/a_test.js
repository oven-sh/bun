import { test, vi } from "bun:test";
test("the names under a mock", async () => {
  await import("./twin.mjs");
  vi.doMock("./store.cjs", () => ({ count: 10 }));
  for (const file of ["./reader.mjs", "./named.mjs"]) {
    console.log(file, await import(file).then(it => it.look(), error => error.name));
  }
});
