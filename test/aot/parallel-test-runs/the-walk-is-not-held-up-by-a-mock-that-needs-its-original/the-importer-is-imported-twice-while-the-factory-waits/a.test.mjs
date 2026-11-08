import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./base.mjs", async o => {
    await new Promise(r => setTimeout(r, 10));
    return { ...(await o()) };
  });
  const first = import("./rung.mjs");
  await null;
  const third = import("./rung.mjs");
  const all = [first, third];
  const said = await Promise.all(
    all.map(each =>
      each.then(
        found => Object.keys(found).join(),
        error => error.name,
      ),
    ),
  );
  console.log("SAID", said.join("|"), globalThis.rungs, globalThis.tops);
});
