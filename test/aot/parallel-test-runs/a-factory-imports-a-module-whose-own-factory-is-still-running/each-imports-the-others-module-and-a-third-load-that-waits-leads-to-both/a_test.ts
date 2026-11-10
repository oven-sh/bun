import { test, vi } from "bun:test";
test("cell", async () => {
  vi.doMock("./one.ts", async () => { await null; const other = await import("./two.ts"); return { one: "mocked one < " + other.two }; });
  vi.doMock("./two.ts", async () => { await null; const other = await import("./one.ts"); return { two: "mocked two < " + other.one }; });
  const say = (load: Promise<{ seen: string }>) => load.then(held => held.seen, error => "rejects " + error.name);
  const [first, second, both] = await Promise.all([say(import("./first.ts")), say(import("./second.ts")), say(import("./both.ts"))]);
  // Which of the three texts is read first is up to the threads that read them, and with it which factory gets the other's original.
  const [inner, outer] = first.length < second.length ? ["one", "two"] : ["two", "one"];
  const name = (seen: string) => seen.replaceAll(inner, "inner").replaceAll(outer, "outer");
  console.log("SAID", [first, second].map(name).sort().join(" | "), "|", both.split(" + ").map(name).sort().join(" + "));
}, 3000);
