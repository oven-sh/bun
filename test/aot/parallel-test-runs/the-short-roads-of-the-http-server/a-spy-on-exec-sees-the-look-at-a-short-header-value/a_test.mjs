// A spy on RegExp.prototype.exec that stands when node:http is first loaded sees the look at a header value, short or long.
import { test, spyOn } from "bun:test";
test("the exec that stood at the load looks at header values", async () => {
  const spy = spyOn(RegExp.prototype, "exec");
  const http = (await import("node:http")).default;
  spy.mockClear();
  http.validateHeaderValue("x-a", "plain");
  const short = spy.mock.calls.length;
  spy.mockClear();
  http.validateHeaderValue("x-a", "p".repeat(40));
  const long = spy.mock.calls.length;
  spy.mockRestore();
  console.log(short, long);
});
