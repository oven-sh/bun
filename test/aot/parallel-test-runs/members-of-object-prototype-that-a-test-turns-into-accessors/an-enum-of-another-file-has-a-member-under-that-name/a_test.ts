import { test } from "bun:test";
test("a", async () => {
  const kept = Object.getOwnPropertyDescriptor(Object.prototype, "valueOf")!;
  let taken = 0, seen = "", has = "";
  Object.defineProperty(Object.prototype, "valueOf", { get() { return kept.value; }, set(v) { taken++; }, configurable: true });
  try { const user = await import("./user"); seen = typeof user.read(); has = String(user.own()); }
  finally { Object.defineProperty(Object.prototype, "valueOf", kept); }
  console.log("a", seen, has, taken);
});
