import { test, vi } from "bun:test";
test("fails", async () => {
  const called = Promise.withResolvers<void>();
  const settles = Promise.withResolvers<{ x: string }>();
  vi.doMock("./kept", () => (called.resolve(), settles.promise));
  const importing = import("./user");
  await called.promise;
  vi.doUnmock("./kept");
  console.log("SAID", (await import("./kept")).x, (await importing).x);
  settles.promise.catch(() => {}); settles.reject(new Error("late"));
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log("SAID", (await import("./kept")).x, (await import("./user")).x);
});
