import { test, vi } from "bun:test";
test("cell", async () => {
  vi.doMock("./one.ts", async () => { await null; const other = await import("./two.ts"); return { one: "mocked one < " + other.two }; });
  vi.doMock("./two.ts", async () => { await null; const other = await import("./one.ts"); return { two: "mocked two < " + other.one }; });
  const say = (load: Promise<{ seen: string }>) => load.then(held => held.seen, error => "rejects " + error.name);
  const all = await Promise.all([say(import("./first.ts")), say(import("./second.ts")), say(import("./both.ts"))]);
  console.log("SAID", all.join(" | "));
}, 3000);
