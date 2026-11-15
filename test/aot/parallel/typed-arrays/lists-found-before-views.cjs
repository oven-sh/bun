// Flags: --aot-harden=proof-checks
// list[i] found in an array bounds list[i - 1] there. Where the same value would be a view, the path is never taken, and the view keeps its own bounds check.
class Merged {
  constructor(source, target, count) {
    this.source = source;
    this.target = target;
    for (let i = 2; i < count; i++) {
      if (target[i] === undefined) continue;
      if (this.source[i] > this.target[i - 1]) this.target[i] = this.source[i];
      else this.target[i] = this.target[i - 1];
    }
  }
}
function merge(lists, target, count) {
  return new Merged(lists[0], target, count).target;
}
function mergeFields(lists, target, count) {
  const both = { source: lists[0], target };
  for (let i = 2; i < count; i += 2) {
    if (target[i] === undefined) continue;
    if (both.source[i] > both.target[i - 1]) both.target[i] = both.source[i];
    else both.target[i] = both.target[i - 1];
  }
  return target;
}
const numbers = () => JSON.parse("[6,5,4,3,2,1]");
const views = [() => new Float64Array(numbers()), () => new Int32Array(numbers()), () => new Uint8Array(numbers())];
for (const run of [merge, mergeFields]) {
  for (const make of [numbers, ...views]) {
    for (const count of [6, 8]) console.log(Array.from(run([JSON.parse("[1,2,3,4,5,6]")], make(), count)).join(), Array.from(run([make()], numbers(), count)).join());
  }
}
