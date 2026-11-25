import { spyOn, test } from "bun:test";
import { decorate } from "./app.js";

test("a spy on replace sees the calls on written texts", () => {
  const spy = spyOn(String.prototype, "replace");
  console.log("watched:", decorate(), "abc".replace(/^/, "!"), spy.mock.calls.length);
  spy.mockImplementation(function () {
    return "from the spy:" + this;
  });
  console.log("answered:", decorate(), "abc".replace(/^/, "!"), spy.mock.calls.length);
  spy.mockRestore();
  console.log("put back:", decorate(), "abc".replace(/^/, "!"));
});
