import { test, vi } from "bun:test";
test("0 jobs behind the answer", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part0.mjs", async () => { called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = import("./part0.mjs");
  await called.promise;
  vi.doUnmock("./part0.mjs");
  gate.resolve();
  for (let job = 0; job < 0; job++) await null;
  void import("./other0.mjs");
  console.log(`SAID 0 ${(await opened).a} ${(await import("./part0.mjs")).a}`);
});
test("3 jobs behind the answer", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part3.mjs", async () => { called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = import("./part3.mjs");
  await called.promise;
  vi.doUnmock("./part3.mjs");
  gate.resolve();
  for (let job = 0; job < 3; job++) await null;
  void import("./other3.mjs");
  console.log(`SAID 3 ${(await opened).a} ${(await import("./part3.mjs")).a}`);
});
test("6 jobs behind the answer", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part6.mjs", async () => { called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = import("./part6.mjs");
  await called.promise;
  vi.doUnmock("./part6.mjs");
  gate.resolve();
  for (let job = 0; job < 6; job++) await null;
  void import("./other6.mjs");
  console.log(`SAID 6 ${(await opened).a} ${(await import("./part6.mjs")).a}`);
});
test("12 jobs behind the answer", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part12.mjs", async () => { called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = import("./part12.mjs");
  await called.promise;
  vi.doUnmock("./part12.mjs");
  gate.resolve();
  for (let job = 0; job < 12; job++) await null;
  void import("./other12.mjs");
  console.log(`SAID 12 ${(await opened).a} ${(await import("./part12.mjs")).a}`);
});
