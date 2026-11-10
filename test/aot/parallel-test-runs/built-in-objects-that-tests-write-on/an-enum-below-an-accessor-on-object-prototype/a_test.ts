import { test } from "bun:test";
const hits: unknown[] = [];
Object.defineProperty(Object.prototype, "Ready", {
  configurable: true,
  get() { return "above"; },
  set(value) { hits.push(value); },
});
function make() {
  enum State { Ready, Done }
  return State as any;
}
test("the member Ready of an enum meets the setter above", () => {
  const made = make();
  console.log(Object.keys(made).join(), String(made.Ready), hits.join(), Object.hasOwn(made, "Ready"));
  delete (Object.prototype as any).Ready;
});
