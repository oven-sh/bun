let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function byApply() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  tick.apply(null, list);
}
function byReflect() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  Reflect.apply(tick, null, list);
}
for (let i = 0; i < 300; i++) byApply();
console.log(calls, reads);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, reads);
