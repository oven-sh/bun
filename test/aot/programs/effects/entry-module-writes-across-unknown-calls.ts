// A closed program: variables written by user code that only a built-in or the host calls (a getter printed by console.log, toString, valueOf, callbacks of forEach and sort, a microtask), read around the call that runs it.
// Six more variables are written by the entry module's call tree alone.
let top1 = 0, top2 = 0, top3 = 0, top4 = 0, top5 = 0, top6 = 0;
let byGetter = 0, byToString = 0, byValueOf = 0, byCallback = 0, bySort = 0, byMicrotask = 0;

function bumpTopLevel(xs: number[]) { for (let i = 0; i < xs.length; i++) { top1 += xs[i]; top2 += xs[i]; top3 += xs[i]; top4 += xs[i]; top5 += xs[i]; top6 += xs[i]; } }
function topLevelSum() { return top1 + top2 + top3 + top4 + top5 + top6; }

const withGetter = { get shown() { byGetter++; return 1; } };
const withToString = { toString() { byToString++; return "text"; } };
const withValueOf = { valueOf() { byValueOf++; return 2; } };

function aroundPrint(o: object) { const t = topLevelSum(), g = byGetter; console.log(o); return [topLevelSum() - t, byGetter - g].join(); }
function aroundConcat(o: object) { const t = topLevelSum(), s = byToString; const text = "" + o; return [text, topLevelSum() - t, byToString - s].join(); }
function aroundMultiply(o: any) { const t = topLevelSum(), v = byValueOf; const product = o * 3; return [product, topLevelSum() - t, byValueOf - v].join(); }
function aroundForEach(xs: number[]) { const t = topLevelSum(), c = byCallback; xs.forEach(x => { byCallback += x; }); return [topLevelSum() - t, byCallback - c].join(); }
function aroundSort(xs: number[]) { const t = topLevelSum(), s = bySort; xs.sort((a, b) => { bySort++; return a - b; }); return [topLevelSum() - t, bySort - s].join(); }
async function aroundAwait() { const t = topLevelSum(), m = byMicrotask; queueMicrotask(() => { byMicrotask++; }); await null; await null; return [topLevelSum() - t, byMicrotask - m].join(); }

for (let round = 0; round < 3; round++) {
  bumpTopLevel([1, 2, round]);
  console.log(aroundPrint(withGetter), aroundPrint({ round }), aroundConcat(withToString), aroundMultiply(withValueOf), aroundForEach([1, round]), aroundSort([3, 1, 2]));
}
aroundAwait().then(text => {
  console.log(text);
  console.log(topLevelSum(), byGetter, byToString, byValueOf, byCallback, bySort, byMicrotask);
});
bumpTopLevel([100]);
