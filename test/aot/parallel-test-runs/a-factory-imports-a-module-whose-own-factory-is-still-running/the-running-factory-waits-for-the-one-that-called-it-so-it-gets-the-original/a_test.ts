import { test, vi } from "bun:test";
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
test("three factories", async () => {
  vi.doMock("./r.ts", async () => { await wait(100); const other = await import("./a.ts"); return { r: "mocked r < " + other.a }; });
  vi.doMock("./a.ts", async () => { await wait(300); const other = await import("./b.ts"); return { a: "mocked a < " + other.b }; });
  vi.doMock("./b.ts", async () => { await wait(300); const other = await import("./r.ts"); return { b: "mocked b < " + other.r }; });
  const early = [import("./uses-r.ts"), import("./uses-a.ts"), import("./r-and-a.ts")];
  await wait(450);
  void import("./b-and-r.ts");
  for (const held of await Promise.all(early)) console.log("SAID", held.seen);
});
