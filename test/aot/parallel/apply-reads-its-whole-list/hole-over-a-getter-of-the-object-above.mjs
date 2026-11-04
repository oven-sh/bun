let calls = 0, reads = 0;
function tick() { calls++; }
const above = Object.create(Array.prototype, { 1: { get() { reads++; return 9; } } });
function byApply() {
  const list = [1, , 3];
  Object.setPrototypeOf(list, above);
  tick.apply(null, list);
}
function byReflect() {
  const list = [1, , 3];
  Object.setPrototypeOf(list, above);
  Reflect.apply(tick, null, list);
}
for (let i = 0; i < 300; i++) byApply();
console.log(calls, reads);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, reads);
