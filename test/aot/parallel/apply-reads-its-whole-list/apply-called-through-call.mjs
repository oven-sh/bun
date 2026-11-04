let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function throughCall() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  Function.prototype.apply.call(tick, null, list);
}
function throughReflect() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  Reflect.apply(Function.prototype.apply, tick, [null, list]);
}
for (let i = 0; i < 300; i++) throughCall();
console.log(calls, reads);
for (let i = 0; i < 300; i++) throughReflect();
console.log(calls, reads);
