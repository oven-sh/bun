import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./dep.cjs", async () => ({ ...(await vi.importActual("./dep.cjs")), extra: 1 }));
  console.log(await import("./sub.cjs").then(it => it.read(), error => error.message.slice(0, 30)));
  vi.doUnmock("./dep.cjs");
  console.log(await import("./sub.cjs").then(it => it.read(), error => error.message.slice(0, 30)));
});
