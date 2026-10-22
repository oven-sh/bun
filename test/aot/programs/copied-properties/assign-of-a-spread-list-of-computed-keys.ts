// `Object.assign({ ...passed }, ...keys.map(key => ({ [key]: received[key] })))`: keys nobody knows go into the fresh target alone. The objects that are read by those keys, and the functions they hold, stay what they are.
function withChanges<T extends Record<string, unknown>>(passed: Record<string, unknown>, received: T, keys: string[]): Record<string, unknown> {
  const changed = keys.length > 0;
  return changed ? Object.assign({ ...passed }, ...keys.map(key => ({ [key]: received[key] }))) : passed;
}
class Counter {
  count = 0;
  step = 1;
  bump() {
    this.count += this.step;
    return this.count;
  }
}
const state = { counter: new Counter(), scale: (x: number) => x * 3, depth: 2 };
const names = JSON.parse('["depth","scale"]') as string[];
const merged = withChanges({ first: 1 }, state, names);
const same = withChanges({ first: 1 }, state, []);
let total = 0;
for (let i = 0; i < 5000000; i++) total += state.counter.bump() + state.scale(i & 3) + state.depth;
console.log(total, Object.keys(merged).join(), merged.depth, typeof merged.scale, Object.keys(same).join());
