// A copy of an array has what its source holds when it is made, and its own stores after that. Nothing that is known of the source for good is known of the copy.
function sum(c) { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; return s; }
function viaSlice(a) { const c = a.slice(); c[1] = "x"; return sum(c); }
function viaSliceFrom(a) { const c = a.slice(1); c[0] = "x"; return sum(c); }
function viaSpread(a) { const c = [...a]; c[1] = "x"; return sum(c); }
function viaSpreadWithMore(a) { const c = [0, ...a, 4]; c[2] = "x"; return sum(c); }
function viaConcat(a) { const c = a.concat(); c[1] = "x"; return sum(c); }
function viaConcatOfTwo(a) { const c = a.concat(a); c[4] = "x"; return sum(c); }
function viaFrom(a) { const c = Array.from(a); c[1] = "x"; return sum(c); }
function viaMap(a) { const c = a.map(x => x); c[1] = "x"; return sum(c); }
function viaFilter(a) { const c = a.filter(x => x > 0); c[1] = "x"; return sum(c); }
function viaToSorted(a) { const c = a.toSorted(); c[1] = "x"; return sum(c); }
function viaToReversed(a) { const c = a.toReversed(); c[1] = "x"; return sum(c); }
function viaWith(a) { const c = a.with(0, 7); c[1] = "x"; return sum(c); }
function viaToSpliced(a) { const c = a.toSpliced(0, 1); c[1] = "x"; return sum(c); }
function viaRest(first, ...c) { c[1] = "x"; return sum(c); }
function viaRestOfSpread(a) { return viaRest(0, ...a); }
function viaDestructuring(a) { const [first, ...c] = a; c[0] = "x"; return first + sum(c); }
function hole(a) { const c = a.slice(); c[5] = 1; return sum(c); }
function holeInSpread(a) { const c = [...a]; delete c[1]; return sum(c); }
function fraction(a) { const c = a.slice(); c[1] = 0.5; return sum(c); }
function fractionInSpread(a) { const c = [...a]; c[1] = 0.5; return sum(c); }
function named(a) { const c = [...a]; c.extra = 9; return sum(c) + c.extra; }
function keeps(a, b, ...rest) { rest[1] = "x"; return sum(rest); }
function forwards(...args) { return keeps(1, 2, ...args); }
function holes(a, ...rest) { rest[4] = 1; return sum(rest); }
function forwardsToHoles(...args) { return holes(1, ...args); }
function fractions(a, ...rest) { rest[0] = 0.5; return sum(rest); }
function forwardsToFractions(...args) { return fractions(1, ...args); }
function names(a, ...rest) { rest.extra = 9; return sum(rest) + rest.extra; }
function forwardsToNames(...args) { return names(1, ...args); }
const all = [viaSlice, viaSliceFrom, viaSpread, viaSpreadWithMore, viaConcat, viaConcatOfTwo, viaFrom, viaMap, viaFilter, viaToSorted, viaToReversed, viaWith, viaToSpliced, viaRestOfSpread, viaDestructuring, hole, holeInSpread, fraction, fractionInSpread, named];
const n = process.argv.length & 1;
const source = [n + 1, n + 2, n + 3];
const out = [];
for (let k = 0; k < all.length; k++) { let r; for (let i = 0; i < 20000; i++) r = all[k](source); out.push(all[k].name + " " + r); }
let r;
for (let i = 0; i < 20000; i++) r = viaSlice(source); out.push("direct viaSlice " + r);
for (let i = 0; i < 20000; i++) r = viaSpread(source); out.push("direct viaSpread " + r);
for (let i = 0; i < 20000; i++) r = viaConcat(source); out.push("direct viaConcat " + r);
for (let i = 0; i < 20000; i++) r = viaMap(source); out.push("direct viaMap " + r);
for (let i = 0; i < 20000; i++) r = viaDestructuring(source); out.push("direct viaDestructuring " + r);
for (let i = 0; i < 20000; i++) r = hole(source); out.push("direct hole " + r);
for (let i = 0; i < 20000; i++) r = fraction(source); out.push("direct fraction " + r);
for (let i = 0; i < 20000; i++) r = forwards(1, 2, 3); out.push("forwards " + r);
for (let i = 0; i < 20000; i++) r = forwardsToHoles(1, 2, 3); out.push("forwardsToHoles " + r);
for (let i = 0; i < 20000; i++) r = forwardsToFractions(1, 2, 3); out.push("forwardsToFractions " + r);
for (let i = 0; i < 20000; i++) r = forwardsToNames(1, 2, 3); out.push("forwardsToNames " + r);
out.push("the source " + sum(source) + " " + source.length);
console.log(out.join("\n"));
