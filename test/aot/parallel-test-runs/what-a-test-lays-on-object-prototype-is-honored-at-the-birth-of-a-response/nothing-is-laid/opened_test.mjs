import { test } from "bun:test";
import http from "node:http";
test("row", () => {
  let reads = 0;
  void 0;
  const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
  const atBirth = reads;
  delete Object.prototype._events;
  console.log("SAID " + atBirth + " " + Object.hasOwn(res, "_events") + " " + typeof res._events);
});
