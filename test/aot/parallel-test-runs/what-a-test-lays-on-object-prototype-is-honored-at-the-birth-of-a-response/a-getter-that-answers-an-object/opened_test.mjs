import { test } from "bun:test";
import http from "node:http";
test("row", () => {
  let reads = 0;
  Object.defineProperty(Object.prototype, "_events", { get() { reads++; return {}; }, configurable: true });
  let res, failed = "";
  try { res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 }); } catch (e) { failed = e.constructor.name; res = {}; }
  const atBirth = reads + failed;
  delete Object.prototype._events;
  console.log("SAID " + atBirth + " " + Object.hasOwn(res, "_events") + " " + typeof res._events);
});
