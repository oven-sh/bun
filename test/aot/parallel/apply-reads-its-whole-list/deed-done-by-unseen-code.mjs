let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
const disturb = (0, eval)("(list, descriptor) => { Object.defineProperty(list, 0, descriptor); }");
function byApply() {
  const list = [1, 2];
  disturb(list, descriptor);
  tick.apply(null, list);
}
function byReflect() {
  const list = [1, 2];
  disturb(list, descriptor);
  Reflect.apply(tick, null, list);
}
for (let i = 0; i < 300; i++) byApply();
console.log(calls, reads);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, reads);
