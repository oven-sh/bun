import { test, vi } from "bun:test";
const jobs = async (n = 20) => { for (let job = 0; job < n; job++) await 0; };
test("t", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), y: 1 }));
  const load = import("./part.mjs");
  const turns = 20; await jobs(turns);
  console.log("SAID begun behind", turns, "turns:", String(globalThis.ran));
  await load.catch(() => {});
  console.log("SAID at the end:", String(globalThis.ran));
});
