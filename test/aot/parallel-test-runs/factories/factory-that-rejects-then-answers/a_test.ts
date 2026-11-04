// The promise of the factory is rejected at its first call. The import() that came to the module fails with that error. The next import() of the module itself asks the factory again.
import { mock, test } from "bun:test";

let calls = 0;
mock.module("./price", () => {
  console.log("factory call", ++calls);
  return calls === 1 ? Promise.reject(new RangeError("not yet")) : { price: "mock price" };
});
const said = (load: Promise<{ price: string }>) =>
  load.then(
    it => it.price,
    error => error.constructor.name + " " + error.message,
  );

test("first the error, then the answer", async () => {
  console.log("first", await said(import("./price")));
  console.log("second", await said(import("./price")));
  console.log("third", await said(import("./price")));
  console.log("calls", calls);
});
