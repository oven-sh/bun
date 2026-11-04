// The load of names.ts was ended by a factory that threw, and keeps the error, even when an import() of the mocked module itself has asked the factory again and got an answer.
// It keeps it until names.ts is taken out of require.cache: the next load of it is a new one, and sees the mock.
import { mock, test } from "bun:test";

let calls = 0;
mock.module("./mocked", () => {
  console.log("factory call", ++calls);
  if (calls === 1) throw new RangeError("from call 1");
  return { v: 1 };
});
const say = (label: string, load: () => unknown) =>
  Promise.resolve()
    .then(load)
    .then(
      value => console.log(label, String(value)),
      error => console.log(label, error.constructor.name, error.message),
    );

test("taken out of the cache", async () => {
  await say("first", async () => (await import("./names")).seen());
  await say("the module itself", async () => (await import("./mocked")).v);
  await say("its importer again", async () => (await import("./names")).seen());
  delete require.cache[require.resolve("./names")];
  await say("behind the deletion", async () => (await import("./names")).seen());
  await say("once more", async () => (await import("./names")).seen());
});
