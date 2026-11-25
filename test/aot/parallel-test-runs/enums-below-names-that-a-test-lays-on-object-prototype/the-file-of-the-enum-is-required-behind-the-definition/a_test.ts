import { test } from "bun:test";
test("a member of an enum is read off its object", () => {
  const taken: unknown[] = [];
  Object.defineProperty(Object.prototype, "Ready", { get() { return "above"; }, set(value) { taken.push(value); }, configurable: true });
  let found;
  try { const states = require("./states.ts"); found = [states.State.Ready, states.State.Done, Object.hasOwn(states.State, "Ready")]; } finally { delete (Object.prototype as any).Ready; }
  console.log(found.join(), taken.join());
});
