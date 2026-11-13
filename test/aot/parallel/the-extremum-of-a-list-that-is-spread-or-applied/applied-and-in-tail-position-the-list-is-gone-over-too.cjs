// Math.max | Math.min applied to a list, and called with a spread list in tail position: the function of the prelude goes over the list there too; what is no list of numbers goes as written.
// STATISTIC: LibraryFunctionsCalledDirectly >= 6
// Under: --aot-testing=CheckProofsAtRunTime: the empty word of a hole stands in no value of which a type is proven
'use strict';
const out = [];
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function widest(list) { return Math.max(...list); }
function narrowest(list) { return Math.min(...list); }
function widestApplied(list) { return Math.max.apply(null, list); }
function narrowestApplied(list) { return Math.min.apply(undefined, list); }
function onTheSpot(list) { const most = Math.max.apply(Math, list); const least = Math.min.apply(null, list); return show(most) + "|" + show(least); }
const log = [];
const lists = [() => [3, -7, 12], () => [3.5, -7.25], () => [], () => [-0, 0], () => [0, -0], () => [1, NaN, 2], () => [1, , 3], () => [1.5, , 3.5], () => new Array(4), () => ["3", "12"], () => [1, 2n], () => [{ valueOf() { log.push("a"); return 4; } }, 9, { valueOf() { log.push("b"); return 11; } }], () => { const l = [1, { valueOf() { l.push(100); return 2; } }, 3]; return l; }, () => null, () => undefined, () => ({ length: 2, 0: 1, 1: 5 }), () => new Float64Array([1.5, 5.5]), () => Array.from({ length: 70000 }, (_, i) => (i * 7919) % 10007)];
for (let round = 0; round < 3; round++) {
  for (const make of lists) {
    for (const ask of [widest, narrowest, widestApplied, narrowestApplied, onTheSpot]) {
      let said;
      try { said = show(ask(make())); } catch (error) { said = error.constructor.name; }
      out.push(said);
    }
  }
}
console.log(out.join(" "));
console.log(log.join(""));
