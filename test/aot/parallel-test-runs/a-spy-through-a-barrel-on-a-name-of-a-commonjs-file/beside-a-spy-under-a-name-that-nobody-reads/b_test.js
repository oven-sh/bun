import { spyOn, test } from "bun:test";
const box = { ping() { return "pong"; } };
const key = ["pi", "ng"].join("");
test("a spy on an object of the test's own", () => {
  const spy = spyOn(box, key);
  console.log("SAID b", box.ping(), spy.mock.calls.length);
  spy.mockRestore();
});
