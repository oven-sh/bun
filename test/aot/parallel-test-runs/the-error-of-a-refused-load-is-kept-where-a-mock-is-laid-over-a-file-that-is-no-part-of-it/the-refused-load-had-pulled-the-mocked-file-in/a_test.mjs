import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = { one: [], two: [] };
  const load = async door => { try { await import("./" + door + ".mjs"); } catch (error) { errors[door].push(error); } };
  await load("one");
  await load("two");
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load("two");
  await load("one");
  console.log("SAID", errors.one.map(error => error === errors.one[0]).join(), errors.two.map(error => error === errors.two[0]).join());
});
