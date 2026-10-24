// A function returns a new closure, and a loop calls that closure at once, on every turn. Such a closure can be kept in the frame, in the same place on every turn. What it captured is read on the turn that made it.
type Read = () => number;
type ReadText = () => string;
function mapThenMap() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).map(x => x + 1); }
function indexedLoop() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); const seen: number[] = []; for (let k = 0; k < makers.length; k++) seen.push(makers[k]()()); return seen; }
function forOf() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); const seen: number[] = []; for (const make of makers) seen.push(make()()); return seen; }
function sumInIndexedLoop() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); let total = 7; for (let k = 0; k < makers.length; k++) total = total * 10 + makers[k]()(); return total; }
function forEachSum() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); let total = 7; makers.forEach(make => { total = total * 10 + make()(); }); return total; }
function reduceAlone() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.reduce((t, make) => t * 10 + make()(), 7); }
function capturedText() { const makers: (() => ReadText)[] = []; for (const w of ["one", "two", "three"]) makers.push(() => () => w); return makers.map(make => make()()).map(x => x + "!"); }
function capturedList() { const makers: (() => () => number[])[] = []; for (let i = 0; i < 3; i++) { const list = [i, i + 1]; makers.push(() => () => list); } return makers.map(make => make()()).map(x => x[1]); }
function fractionInside() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i + 0.5); return makers.map(make => make()()).map(x => x + 1); }
function threeDeep() { const makers: (() => () => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => () => i); return makers.map(make => make()()()).map(x => x + 1); }
function withVar() { const makers: (() => Read)[] = []; for (var i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).map(x => x + 1); }
function constOfList() { const makers: (() => Read)[] = []; for (const i of [4, 5, 6]) makers.push(() => () => i); return makers.map(make => make()()).map(x => x + 1); }
function whileWithConst() { const makers: (() => Read)[] = []; let i = 0; while (i < 3) { const j = i; makers.push(() => () => j); i++; } return makers.map(make => make()()).map(x => x + 1); }
function keptInObjects() { const kept: { make: () => Read }[] = []; for (let i = 0; i < 3; i++) kept.push({ make: () => () => i }); return kept.map(entry => entry.make()()).map(x => x + 1); }
function mapThenFilter() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).filter(x => x > 0); }
function mapThenJoin() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).join("+") + makers.map(make => make()()).length; }
function calledTwice() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => { const read = make(); return read() + read(); }).map(x => x + 1); }
function makerTakesAnArgument() { const makers: ((by: number) => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(by => () => i * by); return makers.map(make => make(2)()).map(x => x + 1); }
function throughAConst() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); const out: number[] = []; for (let k = 0; k < 3; k++) { const make = makers[k]; out.push(make()()); } return out.map(x => x + 1); }
function fortyMakers() { const makers: (() => Read)[] = []; for (let i = 0; i < 40; i++) makers.push(() => () => i); return makers.map(make => make()()).reduce((t, x) => t + x, 0); }
function once() { return [mapThenMap(), indexedLoop(), forOf(), sumInIndexedLoop(), forEachSum(), reduceAlone(), capturedText(), capturedList(), fractionInside(), threeDeep(), withVar(), constOfList(), whileWithConst(), keptInObjects(), mapThenFilter(), mapThenJoin(), calledTwice(), makerTakesAnArgument(), throughAConst(), fortyMakers()].map(String).join(" | "); }
console.log(once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = once();
console.log(last);
