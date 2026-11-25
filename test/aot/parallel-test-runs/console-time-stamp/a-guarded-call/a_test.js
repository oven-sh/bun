import { test } from "bun:test";
const hasTimeStamps = typeof console !== "undefined" && typeof console.timeStamp === "function";
test("a guarded call is left out", () => {
  if (hasTimeStamps) console.timeStamp("x");
  console.log("SAID", hasTimeStamps, "timeStamp" in console, console.timeStamp?.("x"));
});
