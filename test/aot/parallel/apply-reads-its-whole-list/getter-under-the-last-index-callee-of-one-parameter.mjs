let calls = 0, reads = 0, sum = 0;
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 7; } };
function byApply() {
  const list = [1, 2, 3];
  Object.defineProperty(list, 2, descriptor);
  take.apply(null, list);
}
function byReflect() {
  const list = [1, 2, 3];
  Object.defineProperty(list, 2, descriptor);
  Reflect.apply(take, null, list);
}
for (let i = 0; i < 300; i++) byApply();
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, reads, sum);
