import { test, vi } from "bun:test";
const word = (load: Promise<any>) => load.then(it => String(it.x ?? it.seen), error => error.name + ":" + error.message);
let calls = 0;
test("the factory throws at once", async () => {
  vi.doMock("./kept", () => { throw new RangeError("at once " + ++calls); });
  console.log("SAID", await word(import("./user")));
});
test("another mock, whose async factory rejects", async () => {
  vi.doMock("./kept", async () => { await 0; throw new TypeError("late " + ++calls); });
  console.log("SAID", await word(import("./kept")));
});
test("the next test is not touched", () => console.log("SAID last", calls));
