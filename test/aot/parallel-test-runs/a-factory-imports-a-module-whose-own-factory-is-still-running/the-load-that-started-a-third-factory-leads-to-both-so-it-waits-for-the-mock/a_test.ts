import { test, vi } from "bun:test";
test("cell", async () => {
  vi.doMock("./r.ts", async () => { await null; const other = await import("./a.ts"); return { r: "mocked r < " + other.a }; });
  vi.doMock("./a.ts", async () => { await null; const other = await import("./b.ts"); return { a: "mocked a < " + other.b }; });
  vi.doMock("./b.ts", async () => { await null; const other = await import("./r.ts"); return { b: "mocked b < " + other.r }; });
  const say = (load: Promise<{ seen: string }>) => load.then(held => held.seen, error => "rejects " + error.name);
  const all = await Promise.all([say(import("./uses-r.ts")), say(import("./uses-a.ts")), say(import("./all.ts"))]);
  for (const line of all) console.log("SAID", line);
}, 3000);
test("behind it", async () => {
  vi.doMock("./d.ts", async () => { await new Promise(done => setTimeout(done, 5)); return { d: "mocked d" }; });
  vi.doMock("./a.ts", async () => { await null; const other = await import("./d.ts"); return { a: "second a < " + other.d }; });
  const held = await Promise.all([import("./uses-d.ts"), import("./uses-a-again.ts"), import("./a-and-d.ts")]);
  console.log("SAID behind it", held.map(each => each.seen).join(" | "));
}, 3000);
