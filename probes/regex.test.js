import { test, expect } from "bun:test";
const strip = e => Bun.stripANSI(String(e && e.message));
async function poll(label, re, readyAt) {
  let attempts = 0, outcome = "GREEN";
  try {
    await expect.poll(() => ({ ready: ++attempts >= readyAt, s: "x" }), { interval: 1, timeout: 150 })
      .toMatchObject({ ready: true, s: expect.stringMatching(re) });
  } catch (e) { outcome = "RED\n" + strip(e).split("\n").map(l => "      | " + l).join("\n"); }
  console.log(label.padEnd(40), "attempts", String(attempts).padEnd(4), outcome);
}
test("regex", async () => {
  await poll("/x/  (no state)      ready@2", /x/, 2);
  await poll("/x/  (no state)      ready@3", /x/, 3);
  await poll("/x/g (lastIndex)     ready@3", /x/g, 3);
  await poll("/x/g (lastIndex)     ready@4", /x/g, 4);
  await poll("/x/g (lastIndex)     ready@2", /x/g, 2);
});
