import { test, vi } from "bun:test";
test("twice", async () => {
  const errors = { one: [], two: [] }, said = [];
  const load = async door => { try { await import("./" + door + ".mjs"); } catch (error) { const list = errors[door]; said.push(door + " " + (list.length ? (error === list.at(-1) ? "kept" : "anew") : "first")); list.push(error); } };
  await load("one");
  await load("two");
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load("two");
  vi.doUnmock("./far.mjs");
  said.push("ENDED");
  await load("two");
  vi.doMock("./far.mjs", () => ({ far: 20 }));
  said.push("LAID AGAIN");
  await load("two");
  await load("one");
  vi.doUnmock("./far.mjs");
  console.log("SAID", said.join(", "));
});
