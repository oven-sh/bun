// A hole of a list is read through the prototype chain, by a spread and by apply alike: for each kind of storage (integers, doubles, boxed values) the function of the prelude asks each place whether it is filled and leaves the list to the call as written.
// STATISTIC: LibraryFunctionsCalledDirectly >= 8
// Under: --aot-testing=CheckProofsAtRunTime: the empty word of a hole stands in no value of which a type is proven
'use strict';
const out = [];
function show(value) { return Object.is(value, -0) ? "-0" : String(value); }
function spreadInTail(list) { return Math.max(...list); }
function spreadInTailLeast(list) { return Math.min(...list); }
function appliedInTail(list) { return Math.max.apply(null, list); }
function appliedInTailLeast(list) { return Math.min.apply(null, list); }
function spreadOnTheSpot(list) { const most = Math.max(...list); const least = Math.min(...list); return show(most) + "|" + show(least); }
function appliedOnTheSpot(list) { const most = Math.max.apply(null, list); const least = Math.min.apply(null, list); return show(most) + "|" + show(least); }
class Mine extends Array {}
Mine.prototype[1] = 9.5;
function above(list, place, value) { Object.setPrototypeOf(list, { __proto__: Array.prototype, [place]: value }); return list; }
function boxed(...values) { const list = ["x", ...values]; list.shift(); return list; }
const makers = [
  () => { const l = [1.5, 2.5, 3.5]; delete l[1]; return above(l, 1, 9.5); },
  () => { const l = Mine.from([1.5, 2.5, 3.5]); delete l[1]; return l; },
  () => { const l = [1.5, 2.5]; l.length = 3; return above(l, 2, -9.5); },
  () => { const l = [1, 2, 3]; delete l[1]; return above(l, 1, 9); },
  () => { const l = Mine.from([1, 2, 3]); delete l[1]; return l; },
  () => { const l = [1, 2]; l.length = 3; return above(l, 2, -9); },
  () => { const l = boxed(1.5, 2, 3.5); delete l[1]; return above(l, 1, 9.5); },
  () => { const l = boxed(1, 2); l.length = 3; return above(l, 2, -9.5); },
  () => { const l = [1.5, 2.5, 3.5]; delete l[1]; return above(l, 1, "12"); },
  () => { const l = [1.5, 2.5, 3.5]; delete l[1]; return l; },
  () => [1.5, NaN, 3.5],
  () => boxed(1.5, NaN, 3.5),
  () => [-0, 0.5 - 0.5], () => [0.5 - 0.5, -0], () => [-0, -0, -1.5], () => [-0, -0, 1.5],
  () => boxed(-0, 0), () => boxed(0, -0), () => boxed(-0, -0),
  () => [Infinity, -Infinity, 1.5], () => [-Infinity], () => [Infinity],
];
for (let round = 0; round < 3; round++) {
  for (const make of makers) {
    for (const ask of [spreadInTail, spreadInTailLeast, appliedInTail, appliedInTailLeast, spreadOnTheSpot, appliedOnTheSpot]) {
      let said;
      try { said = show(ask(make())); } catch (error) { said = error.constructor.name; }
      out.push(said);
    }
  }
}
console.log(out.join(" "));
