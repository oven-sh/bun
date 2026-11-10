import { test, vi } from "bun:test";
const later = (ms: number) => new Promise(done => setTimeout(done, ms));
test("first", async () => {
  vi.doMock("./r.ts", async () => { await new Promise(() => {}); return { r: "never" }; });
  vi.doMock("./x.ts", async () => { await null; await import("./r.ts"); return { x: "first x" }; });
  import("./uses-r.ts"); import("./uses-x.ts"); import("./both.ts");
  await later(20); console.log("SAID first is over");
}, 3000);
test("second", async () => {
  vi.doMock("./x.ts", async () => { await later(5); return { x: "second x" }; });
  vi.doMock("./r.ts", async () => { await null; const other = await import("./x.ts"); return { r: "mocked r < " + other.x }; });
  const held = await Promise.all([import("./uses-x-again.ts"), import("./uses-r-again.ts"), import("./both-again.ts")]);
  console.log("SAID second", held.map(each => each.seen).join(" | "));
}, 3000);
