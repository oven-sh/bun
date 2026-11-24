import { test, vi } from "bun:test";
test("a test leaves a factory that never settles", async () => {
  const called = Promise.withResolvers<void>();
  vi.doMock("./r.ts", () => (called.resolve(), new Promise(() => {})));
  void import("./uses-r.ts");
  await called.promise;
});
test("the mock of the next test", async () => {
  vi.doMock("./r.ts", async () => {
    console.log("SAID the factory is called");
    return { r: "mocked r < " + (await import("./x.ts")).x };
  });
  console.log("SAID behind the mock call");
  console.log("SAID", (await import("./uses-r-again.ts")).seen);
});
