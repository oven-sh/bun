// `tick.apply(null, list)`: apply reads every element of the list, whatever the callee takes: a getter under an index runs, though `tick` has no parameter.
import { test } from "bun:test";
let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  return list;
}
function byApply() { tick.apply(null, makeList()); }
function byReflect() { Reflect.apply(tick, null, makeList()); }
function ofLiteral(i) { tick.apply(null, [i, 2]); }
function ofRest(...rest) { tick.apply(null, rest); }
test("by apply", () => {
  for (let i = 0; i < 300; i++) byApply();
  console.log(calls, reads);
});
test("by Reflect.apply", () => {
  for (let i = 0; i < 300; i++) byReflect();
  console.log(calls, reads);
});
test("lists that nothing else has", () => {
  for (let i = 0; i < 300; i++) { ofLiteral(i); ofRest(i, i); }
  console.log(calls, reads);
});
