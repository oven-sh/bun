// The load of names.ts was ended by a factory that threw, and keeps the error. A new mock of the module below takes the kept records out of the loader: the next load asks the new factory.
import { mock, test } from "bun:test";

mock.module("./mocked", () => {
  console.log("the first factory is called");
  throw new RangeError("from the first factory");
});
const say = (label: string, load: () => unknown) =>
  Promise.resolve()
    .then(load)
    .then(
      value => console.log(label, String(value)),
      error => console.log(label, error.constructor.name, error.message),
    );

test("mocked again", async () => {
  await say("first", async () => (await import("./names")).seen());
  await say("again", async () => (await import("./names")).seen());
  mock.module("./mocked", () => {
    console.log("the second factory is called");
    return { v: 1 };
  });
  await say("behind the second mock", async () => (await import("./names")).seen());
  await say("once more", async () => (await import("./names")).seen());
});
