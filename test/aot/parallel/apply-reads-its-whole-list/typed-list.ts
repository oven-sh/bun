let calls = 0, reads = 0;
function tick(): void { calls++; }
function byApply(list: number[]): void { tick.apply(null, list as []); }
function byReflect(list: number[]): void { Reflect.apply(tick, null, list); }
function makeList(): number[] {
  const list: number[] = [1, 2];
  Object.defineProperty(list, 0, { get(): number { reads++; return 1; } });
  return list;
}
const kept: number[] = makeList();
for (let i = 0; i < 300; i++) byApply(kept);
console.log(calls, reads);
for (let i = 0; i < 300; i++) byReflect(makeList());
console.log(calls, reads);
