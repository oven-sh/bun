// Function expressions that capture nothing, evaluated again and again: which of them are still made each time?
const N = 20000;
let state = 1;
function readFirst(): number { return state; }
function readSecond(): number { return state + 1; }
interface Sources { first(): number; second(): number; third: () => number; fourth: () => number }
function pick(sources: Sources, key: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += (key + i) % 3 === 0 ? sources.first() : (key + i) % 3 === 1 ? sources.second() : sources.third();
  return sum + (key === -1 ? sources.fourth() : 0);
}
function literalToCallee(key: number): number {
  return pick({ first: () => readFirst(), second: () => readSecond(), third: () => 3, fourth: () => 4 }, key);
}
const held: Sources[] = [];
function literalThatIsKept(key: number): number {
  const sources: Sources = { first: () => readFirst(), second: () => readSecond(), third: () => 3, fourth: () => 4 };
  if ((key & 4095) === 0) held.push(sources);
  return pick(sources, key);
}
function callbackToMap(key: number): number { return [key, key + 1, key + 2].map(x => x * 2)[1]; }
function callbackToFilter(key: number): number { return [key, key + 1, key + 2].filter(x => x % 2 === 0).length; }
function callbackToSort(key: number): number { return [key + 2, key, key + 1].sort((a, b) => a - b)[0]; }
function apply(f: (x: number) => number, x: number): number { let s = 0; for (let i = 0; i < 2; i++) s += f(x + i); return s; }
function callbackToOwnFunction(key: number): number { return apply(x => x + 1, key); }
function returned(): () => number { return () => 7; }
function returnedAndCalled(key: number): number { return returned()() + key; }
const listeners = new Set<() => number>();
function intoASet(key: number): number { const f = () => 9; listeners.add(f); const n = listeners.size; listeners.delete(f); return n + key; }
function compared(key: number): number { const f = () => 1, g = () => 1; return (f as unknown) === (g as unknown) ? 1 : key; }
function promiseThen(key: number): number { Promise.resolve(key).then(v => v + 1); return key; }
const ways: Record<string, (key: number) => number> = { literalToCallee, literalThatIsKept, callbackToMap, callbackToFilter, callbackToSort, callbackToOwnFunction, returnedAndCalled, intoASet, compared, promiseThen };
const only = process.env.WAYS_ONLY;
let total = 0;
for (const name in ways) {
  if (only && only !== name) continue;
  const way = ways[name];
  for (let i = 0; i < N; i++) total += way(i);
}
console.log(total, held.length);
