// RUN: lower
// OPTIONS: builtin-modules

// Array methods called on instances of subclasses of Array, some of which override a method or `Symbol.species`, through every form of call.
function say(name, f) { let r; try { r = f(); } catch (e) { r = "threw " + e.name; } console.log(name + ": " + r); }
function busy(x) { return x; } const keepsBusy = () => busy;                                   // a module's function that another function captures: no inert argument
const S = v => { try { return JSON.stringify(v); } catch (e) { return "unprintable"; } };
class H extends Array {} class HJ extends Array { join() { return "H's join"; } } class HS extends Array { static get [Symbol.species]() { return Array; } }
class HC extends Array { constructor(...a) { super(...a); HC.made = (HC.made || 0) + 1; } }
class P2 extends Promise { constructor(f) { super(f); P2.made = (P2.made || 0) + 1; } extra() { return "extra"; } }
class U8 extends Uint8Array {} class R2 extends RegExp { exec(s) { R2.calls = (R2.calls || 0) + 1; return super.exec(s); } }
class R3 extends RegExp { [Symbol.replace](s, r) { return "R3's replace"; } [Symbol.match](s) { return ["R3's match"]; } [Symbol.search](s) { return -7; } [Symbol.split](s) { return ["R3's split"]; } }
const kind = r => (r === null || r === undefined ? String(r) : r.constructor && r.constructor.name) + (Array.isArray(r) ? S(r) : "");
say("an heir map [direct]", () => { const a = H.of(3, 1, 2); const r = a.map(x => x * 2); return kind(r); });
say("an heir map [key]", () => { const a = H.of(3, 1, 2); const r = a["map"](x => x * 2); return kind(r); });
say("an heir map [optional]", () => { const a = H.of(3, 1, 2); const r = a.map?.(x => x * 2); return kind(r); });
say("an heir map [spread]", () => { const a = H.of(3, 1, 2); const r = a.map(...[x => x * 2]); return kind(r); });
say("an heir map [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, x => x * 2))(a.map); return kind(r); });
say("an heir map [busy]", () => { const a = H.of(3, 1, 2); const r = a.map(busy(x => x * 2)); return kind(r); });
say("an heir filter [direct]", () => { const a = H.of(3, 1, 2); const r = a.filter(x => x > 1); return kind(r); });
say("an heir filter [key]", () => { const a = H.of(3, 1, 2); const r = a["filter"](x => x > 1); return kind(r); });
say("an heir filter [optional]", () => { const a = H.of(3, 1, 2); const r = a.filter?.(x => x > 1); return kind(r); });
say("an heir filter [spread]", () => { const a = H.of(3, 1, 2); const r = a.filter(...[x => x > 1]); return kind(r); });
say("an heir filter [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r); });
say("an heir filter [busy]", () => { const a = H.of(3, 1, 2); const r = a.filter(busy(x => x > 1)); return kind(r); });
say("an heir flatMap [direct]", () => { const a = H.of(3, 1, 2); const r = a.flatMap(x => [x, x]); return kind(r); });
say("an heir flatMap [key]", () => { const a = H.of(3, 1, 2); const r = a["flatMap"](x => [x, x]); return kind(r); });
say("an heir flatMap [optional]", () => { const a = H.of(3, 1, 2); const r = a.flatMap?.(x => [x, x]); return kind(r); });
say("an heir flatMap [spread]", () => { const a = H.of(3, 1, 2); const r = a.flatMap(...[x => [x, x]]); return kind(r); });
say("an heir flatMap [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, x => [x, x]))(a.flatMap); return kind(r); });
say("an heir flatMap [busy]", () => { const a = H.of(3, 1, 2); const r = a.flatMap(busy(x => [x, x])); return kind(r); });
say("an heir slice [direct]", () => { const a = H.of(3, 1, 2); const r = a.slice(1); return kind(r); });
say("an heir slice [key]", () => { const a = H.of(3, 1, 2); const r = a["slice"](1); return kind(r); });
say("an heir slice [optional]", () => { const a = H.of(3, 1, 2); const r = a.slice?.(1); return kind(r); });
say("an heir slice [spread]", () => { const a = H.of(3, 1, 2); const r = a.slice(...[1]); return kind(r); });
say("an heir slice [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, 1))(a.slice); return kind(r); });
say("an heir slice [busy]", () => { const a = H.of(3, 1, 2); const r = a.slice(busy(1)); return kind(r); });
say("an heir splice [direct]", () => { const a = H.of(3, 1, 2); const r = a.splice(0, 1); return kind(r); });
say("an heir splice [key]", () => { const a = H.of(3, 1, 2); const r = a["splice"](0, 1); return kind(r); });
say("an heir splice [optional]", () => { const a = H.of(3, 1, 2); const r = a.splice?.(0, 1); return kind(r); });
say("an heir splice [spread]", () => { const a = H.of(3, 1, 2); const r = a.splice(...[0, 1]); return kind(r); });
say("an heir splice [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.splice); return kind(r); });
say("an heir splice [busy]", () => { const a = H.of(3, 1, 2); const r = a.splice(busy(0), 1); return kind(r); });
say("an heir concat [direct]", () => { const a = H.of(3, 1, 2); const r = a.concat([9]); return kind(r); });
say("an heir concat [key]", () => { const a = H.of(3, 1, 2); const r = a["concat"]([9]); return kind(r); });
say("an heir concat [optional]", () => { const a = H.of(3, 1, 2); const r = a.concat?.([9]); return kind(r); });
say("an heir concat [spread]", () => { const a = H.of(3, 1, 2); const r = a.concat(...[[9]]); return kind(r); });
say("an heir concat [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, [9]))(a.concat); return kind(r); });
say("an heir concat [busy]", () => { const a = H.of(3, 1, 2); const r = a.concat(busy([9])); return kind(r); });
say("an heir toSorted [direct]", () => { const a = H.of(3, 1, 2); const r = a.toSorted(); return kind(r); });
say("an heir toSorted [key]", () => { const a = H.of(3, 1, 2); const r = a["toSorted"](); return kind(r); });
say("an heir toSorted [optional]", () => { const a = H.of(3, 1, 2); const r = a.toSorted?.(); return kind(r); });
say("an heir toSorted [spread]", () => { const a = H.of(3, 1, 2); const r = a.toSorted(...[]); return kind(r); });
say("an heir toSorted [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a))(a.toSorted); return kind(r); });
say("an heir toReversed [direct]", () => { const a = H.of(3, 1, 2); const r = a.toReversed(); return kind(r); });
say("an heir toReversed [key]", () => { const a = H.of(3, 1, 2); const r = a["toReversed"](); return kind(r); });
say("an heir toReversed [optional]", () => { const a = H.of(3, 1, 2); const r = a.toReversed?.(); return kind(r); });
say("an heir toReversed [spread]", () => { const a = H.of(3, 1, 2); const r = a.toReversed(...[]); return kind(r); });
say("an heir toReversed [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a))(a.toReversed); return kind(r); });
say("an heir toSpliced [direct]", () => { const a = H.of(3, 1, 2); const r = a.toSpliced(0, 1); return kind(r); });
say("an heir toSpliced [key]", () => { const a = H.of(3, 1, 2); const r = a["toSpliced"](0, 1); return kind(r); });
say("an heir toSpliced [optional]", () => { const a = H.of(3, 1, 2); const r = a.toSpliced?.(0, 1); return kind(r); });
say("an heir toSpliced [spread]", () => { const a = H.of(3, 1, 2); const r = a.toSpliced(...[0, 1]); return kind(r); });
say("an heir toSpliced [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.toSpliced); return kind(r); });
say("an heir toSpliced [busy]", () => { const a = H.of(3, 1, 2); const r = a.toSpliced(busy(0), 1); return kind(r); });
say("an heir with [direct]", () => { const a = H.of(3, 1, 2); const r = a.with(0, 7); return kind(r); });
say("an heir with [key]", () => { const a = H.of(3, 1, 2); const r = a["with"](0, 7); return kind(r); });
say("an heir with [optional]", () => { const a = H.of(3, 1, 2); const r = a.with?.(0, 7); return kind(r); });
say("an heir with [spread]", () => { const a = H.of(3, 1, 2); const r = a.with(...[0, 7]); return kind(r); });
say("an heir with [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a, 0, 7))(a.with); return kind(r); });
say("an heir with [busy]", () => { const a = H.of(3, 1, 2); const r = a.with(busy(0), 7); return kind(r); });
say("an heir flat [direct]", () => { const a = H.of(3, 1, 2); const r = a.flat(); return kind(r); });
say("an heir flat [key]", () => { const a = H.of(3, 1, 2); const r = a["flat"](); return kind(r); });
say("an heir flat [optional]", () => { const a = H.of(3, 1, 2); const r = a.flat?.(); return kind(r); });
say("an heir flat [spread]", () => { const a = H.of(3, 1, 2); const r = a.flat(...[]); return kind(r); });
say("an heir flat [call]", () => { const a = H.of(3, 1, 2); const r = (f => f.call(a))(a.flat); return kind(r); });
say("an heir that counts map [direct]", () => { const a = HC.of(3, 1, 2); const r = a.map(x => x * 2); return kind(r); });
say("an heir that counts map [key]", () => { const a = HC.of(3, 1, 2); const r = a["map"](x => x * 2); return kind(r); });
say("an heir that counts map [optional]", () => { const a = HC.of(3, 1, 2); const r = a.map?.(x => x * 2); return kind(r); });
say("an heir that counts map [spread]", () => { const a = HC.of(3, 1, 2); const r = a.map(...[x => x * 2]); return kind(r); });
say("an heir that counts map [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, x => x * 2))(a.map); return kind(r); });
say("an heir that counts map [busy]", () => { const a = HC.of(3, 1, 2); const r = a.map(busy(x => x * 2)); return kind(r); });
say("an heir that counts filter [direct]", () => { const a = HC.of(3, 1, 2); const r = a.filter(x => x > 1); return kind(r); });
say("an heir that counts filter [key]", () => { const a = HC.of(3, 1, 2); const r = a["filter"](x => x > 1); return kind(r); });
say("an heir that counts filter [optional]", () => { const a = HC.of(3, 1, 2); const r = a.filter?.(x => x > 1); return kind(r); });
say("an heir that counts filter [spread]", () => { const a = HC.of(3, 1, 2); const r = a.filter(...[x => x > 1]); return kind(r); });
say("an heir that counts filter [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r); });
say("an heir that counts filter [busy]", () => { const a = HC.of(3, 1, 2); const r = a.filter(busy(x => x > 1)); return kind(r); });
say("an heir that counts flatMap [direct]", () => { const a = HC.of(3, 1, 2); const r = a.flatMap(x => [x, x]); return kind(r); });
say("an heir that counts flatMap [key]", () => { const a = HC.of(3, 1, 2); const r = a["flatMap"](x => [x, x]); return kind(r); });
say("an heir that counts flatMap [optional]", () => { const a = HC.of(3, 1, 2); const r = a.flatMap?.(x => [x, x]); return kind(r); });
say("an heir that counts flatMap [spread]", () => { const a = HC.of(3, 1, 2); const r = a.flatMap(...[x => [x, x]]); return kind(r); });
say("an heir that counts flatMap [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, x => [x, x]))(a.flatMap); return kind(r); });
say("an heir that counts flatMap [busy]", () => { const a = HC.of(3, 1, 2); const r = a.flatMap(busy(x => [x, x])); return kind(r); });
say("an heir that counts slice [direct]", () => { const a = HC.of(3, 1, 2); const r = a.slice(1); return kind(r); });
say("an heir that counts slice [key]", () => { const a = HC.of(3, 1, 2); const r = a["slice"](1); return kind(r); });
say("an heir that counts slice [optional]", () => { const a = HC.of(3, 1, 2); const r = a.slice?.(1); return kind(r); });
say("an heir that counts slice [spread]", () => { const a = HC.of(3, 1, 2); const r = a.slice(...[1]); return kind(r); });
say("an heir that counts slice [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, 1))(a.slice); return kind(r); });
say("an heir that counts slice [busy]", () => { const a = HC.of(3, 1, 2); const r = a.slice(busy(1)); return kind(r); });
say("an heir that counts splice [direct]", () => { const a = HC.of(3, 1, 2); const r = a.splice(0, 1); return kind(r); });
say("an heir that counts splice [key]", () => { const a = HC.of(3, 1, 2); const r = a["splice"](0, 1); return kind(r); });
say("an heir that counts splice [optional]", () => { const a = HC.of(3, 1, 2); const r = a.splice?.(0, 1); return kind(r); });
say("an heir that counts splice [spread]", () => { const a = HC.of(3, 1, 2); const r = a.splice(...[0, 1]); return kind(r); });
say("an heir that counts splice [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.splice); return kind(r); });
say("an heir that counts splice [busy]", () => { const a = HC.of(3, 1, 2); const r = a.splice(busy(0), 1); return kind(r); });
say("an heir that counts concat [direct]", () => { const a = HC.of(3, 1, 2); const r = a.concat([9]); return kind(r); });
say("an heir that counts concat [key]", () => { const a = HC.of(3, 1, 2); const r = a["concat"]([9]); return kind(r); });
say("an heir that counts concat [optional]", () => { const a = HC.of(3, 1, 2); const r = a.concat?.([9]); return kind(r); });
say("an heir that counts concat [spread]", () => { const a = HC.of(3, 1, 2); const r = a.concat(...[[9]]); return kind(r); });
say("an heir that counts concat [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, [9]))(a.concat); return kind(r); });
say("an heir that counts concat [busy]", () => { const a = HC.of(3, 1, 2); const r = a.concat(busy([9])); return kind(r); });
say("an heir that counts toSorted [direct]", () => { const a = HC.of(3, 1, 2); const r = a.toSorted(); return kind(r); });
say("an heir that counts toSorted [key]", () => { const a = HC.of(3, 1, 2); const r = a["toSorted"](); return kind(r); });
say("an heir that counts toSorted [optional]", () => { const a = HC.of(3, 1, 2); const r = a.toSorted?.(); return kind(r); });
say("an heir that counts toSorted [spread]", () => { const a = HC.of(3, 1, 2); const r = a.toSorted(...[]); return kind(r); });
say("an heir that counts toSorted [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a))(a.toSorted); return kind(r); });
say("an heir that counts toReversed [direct]", () => { const a = HC.of(3, 1, 2); const r = a.toReversed(); return kind(r); });
say("an heir that counts toReversed [key]", () => { const a = HC.of(3, 1, 2); const r = a["toReversed"](); return kind(r); });
say("an heir that counts toReversed [optional]", () => { const a = HC.of(3, 1, 2); const r = a.toReversed?.(); return kind(r); });
say("an heir that counts toReversed [spread]", () => { const a = HC.of(3, 1, 2); const r = a.toReversed(...[]); return kind(r); });
say("an heir that counts toReversed [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a))(a.toReversed); return kind(r); });
say("an heir that counts toSpliced [direct]", () => { const a = HC.of(3, 1, 2); const r = a.toSpliced(0, 1); return kind(r); });
say("an heir that counts toSpliced [key]", () => { const a = HC.of(3, 1, 2); const r = a["toSpliced"](0, 1); return kind(r); });
say("an heir that counts toSpliced [optional]", () => { const a = HC.of(3, 1, 2); const r = a.toSpliced?.(0, 1); return kind(r); });
say("an heir that counts toSpliced [spread]", () => { const a = HC.of(3, 1, 2); const r = a.toSpliced(...[0, 1]); return kind(r); });
say("an heir that counts toSpliced [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.toSpliced); return kind(r); });
say("an heir that counts toSpliced [busy]", () => { const a = HC.of(3, 1, 2); const r = a.toSpliced(busy(0), 1); return kind(r); });
say("an heir that counts with [direct]", () => { const a = HC.of(3, 1, 2); const r = a.with(0, 7); return kind(r); });
say("an heir that counts with [key]", () => { const a = HC.of(3, 1, 2); const r = a["with"](0, 7); return kind(r); });
say("an heir that counts with [optional]", () => { const a = HC.of(3, 1, 2); const r = a.with?.(0, 7); return kind(r); });
say("an heir that counts with [spread]", () => { const a = HC.of(3, 1, 2); const r = a.with(...[0, 7]); return kind(r); });
say("an heir that counts with [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a, 0, 7))(a.with); return kind(r); });
say("an heir that counts with [busy]", () => { const a = HC.of(3, 1, 2); const r = a.with(busy(0), 7); return kind(r); });
say("an heir that counts flat [direct]", () => { const a = HC.of(3, 1, 2); const r = a.flat(); return kind(r); });
say("an heir that counts flat [key]", () => { const a = HC.of(3, 1, 2); const r = a["flat"](); return kind(r); });
say("an heir that counts flat [optional]", () => { const a = HC.of(3, 1, 2); const r = a.flat?.(); return kind(r); });
say("an heir that counts flat [spread]", () => { const a = HC.of(3, 1, 2); const r = a.flat(...[]); return kind(r); });
say("an heir that counts flat [call]", () => { const a = HC.of(3, 1, 2); const r = (f => f.call(a))(a.flat); return kind(r); });
say("an heir with species Array map [direct]", () => { const a = HS.of(3, 1, 2); const r = a.map(x => x * 2); return kind(r); });
say("an heir with species Array map [key]", () => { const a = HS.of(3, 1, 2); const r = a["map"](x => x * 2); return kind(r); });
say("an heir with species Array map [optional]", () => { const a = HS.of(3, 1, 2); const r = a.map?.(x => x * 2); return kind(r); });
say("an heir with species Array map [spread]", () => { const a = HS.of(3, 1, 2); const r = a.map(...[x => x * 2]); return kind(r); });
say("an heir with species Array map [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, x => x * 2))(a.map); return kind(r); });
say("an heir with species Array map [busy]", () => { const a = HS.of(3, 1, 2); const r = a.map(busy(x => x * 2)); return kind(r); });
say("an heir with species Array filter [direct]", () => { const a = HS.of(3, 1, 2); const r = a.filter(x => x > 1); return kind(r); });
say("an heir with species Array filter [key]", () => { const a = HS.of(3, 1, 2); const r = a["filter"](x => x > 1); return kind(r); });
say("an heir with species Array filter [optional]", () => { const a = HS.of(3, 1, 2); const r = a.filter?.(x => x > 1); return kind(r); });
say("an heir with species Array filter [spread]", () => { const a = HS.of(3, 1, 2); const r = a.filter(...[x => x > 1]); return kind(r); });
say("an heir with species Array filter [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r); });
say("an heir with species Array filter [busy]", () => { const a = HS.of(3, 1, 2); const r = a.filter(busy(x => x > 1)); return kind(r); });
say("an heir with species Array flatMap [direct]", () => { const a = HS.of(3, 1, 2); const r = a.flatMap(x => [x, x]); return kind(r); });
say("an heir with species Array flatMap [key]", () => { const a = HS.of(3, 1, 2); const r = a["flatMap"](x => [x, x]); return kind(r); });
say("an heir with species Array flatMap [optional]", () => { const a = HS.of(3, 1, 2); const r = a.flatMap?.(x => [x, x]); return kind(r); });
say("an heir with species Array flatMap [spread]", () => { const a = HS.of(3, 1, 2); const r = a.flatMap(...[x => [x, x]]); return kind(r); });
say("an heir with species Array flatMap [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, x => [x, x]))(a.flatMap); return kind(r); });
say("an heir with species Array flatMap [busy]", () => { const a = HS.of(3, 1, 2); const r = a.flatMap(busy(x => [x, x])); return kind(r); });
say("an heir with species Array slice [direct]", () => { const a = HS.of(3, 1, 2); const r = a.slice(1); return kind(r); });
say("an heir with species Array slice [key]", () => { const a = HS.of(3, 1, 2); const r = a["slice"](1); return kind(r); });
say("an heir with species Array slice [optional]", () => { const a = HS.of(3, 1, 2); const r = a.slice?.(1); return kind(r); });
say("an heir with species Array slice [spread]", () => { const a = HS.of(3, 1, 2); const r = a.slice(...[1]); return kind(r); });
say("an heir with species Array slice [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, 1))(a.slice); return kind(r); });
say("an heir with species Array slice [busy]", () => { const a = HS.of(3, 1, 2); const r = a.slice(busy(1)); return kind(r); });
say("an heir with species Array splice [direct]", () => { const a = HS.of(3, 1, 2); const r = a.splice(0, 1); return kind(r); });
say("an heir with species Array splice [key]", () => { const a = HS.of(3, 1, 2); const r = a["splice"](0, 1); return kind(r); });
say("an heir with species Array splice [optional]", () => { const a = HS.of(3, 1, 2); const r = a.splice?.(0, 1); return kind(r); });
say("an heir with species Array splice [spread]", () => { const a = HS.of(3, 1, 2); const r = a.splice(...[0, 1]); return kind(r); });
say("an heir with species Array splice [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.splice); return kind(r); });
say("an heir with species Array splice [busy]", () => { const a = HS.of(3, 1, 2); const r = a.splice(busy(0), 1); return kind(r); });
say("an heir with species Array concat [direct]", () => { const a = HS.of(3, 1, 2); const r = a.concat([9]); return kind(r); });
say("an heir with species Array concat [key]", () => { const a = HS.of(3, 1, 2); const r = a["concat"]([9]); return kind(r); });
say("an heir with species Array concat [optional]", () => { const a = HS.of(3, 1, 2); const r = a.concat?.([9]); return kind(r); });
say("an heir with species Array concat [spread]", () => { const a = HS.of(3, 1, 2); const r = a.concat(...[[9]]); return kind(r); });
say("an heir with species Array concat [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, [9]))(a.concat); return kind(r); });
say("an heir with species Array concat [busy]", () => { const a = HS.of(3, 1, 2); const r = a.concat(busy([9])); return kind(r); });
say("an heir with species Array toSorted [direct]", () => { const a = HS.of(3, 1, 2); const r = a.toSorted(); return kind(r); });
say("an heir with species Array toSorted [key]", () => { const a = HS.of(3, 1, 2); const r = a["toSorted"](); return kind(r); });
say("an heir with species Array toSorted [optional]", () => { const a = HS.of(3, 1, 2); const r = a.toSorted?.(); return kind(r); });
say("an heir with species Array toSorted [spread]", () => { const a = HS.of(3, 1, 2); const r = a.toSorted(...[]); return kind(r); });
say("an heir with species Array toSorted [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a))(a.toSorted); return kind(r); });
say("an heir with species Array toReversed [direct]", () => { const a = HS.of(3, 1, 2); const r = a.toReversed(); return kind(r); });
say("an heir with species Array toReversed [key]", () => { const a = HS.of(3, 1, 2); const r = a["toReversed"](); return kind(r); });
say("an heir with species Array toReversed [optional]", () => { const a = HS.of(3, 1, 2); const r = a.toReversed?.(); return kind(r); });
say("an heir with species Array toReversed [spread]", () => { const a = HS.of(3, 1, 2); const r = a.toReversed(...[]); return kind(r); });
say("an heir with species Array toReversed [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a))(a.toReversed); return kind(r); });
say("an heir with species Array toSpliced [direct]", () => { const a = HS.of(3, 1, 2); const r = a.toSpliced(0, 1); return kind(r); });
say("an heir with species Array toSpliced [key]", () => { const a = HS.of(3, 1, 2); const r = a["toSpliced"](0, 1); return kind(r); });
say("an heir with species Array toSpliced [optional]", () => { const a = HS.of(3, 1, 2); const r = a.toSpliced?.(0, 1); return kind(r); });
say("an heir with species Array toSpliced [spread]", () => { const a = HS.of(3, 1, 2); const r = a.toSpliced(...[0, 1]); return kind(r); });
say("an heir with species Array toSpliced [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, 0, 1))(a.toSpliced); return kind(r); });
say("an heir with species Array toSpliced [busy]", () => { const a = HS.of(3, 1, 2); const r = a.toSpliced(busy(0), 1); return kind(r); });
say("an heir with species Array with [direct]", () => { const a = HS.of(3, 1, 2); const r = a.with(0, 7); return kind(r); });
say("an heir with species Array with [key]", () => { const a = HS.of(3, 1, 2); const r = a["with"](0, 7); return kind(r); });
say("an heir with species Array with [optional]", () => { const a = HS.of(3, 1, 2); const r = a.with?.(0, 7); return kind(r); });
say("an heir with species Array with [spread]", () => { const a = HS.of(3, 1, 2); const r = a.with(...[0, 7]); return kind(r); });
say("an heir with species Array with [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a, 0, 7))(a.with); return kind(r); });
say("an heir with species Array with [busy]", () => { const a = HS.of(3, 1, 2); const r = a.with(busy(0), 7); return kind(r); });
say("an heir with species Array flat [direct]", () => { const a = HS.of(3, 1, 2); const r = a.flat(); return kind(r); });
say("an heir with species Array flat [key]", () => { const a = HS.of(3, 1, 2); const r = a["flat"](); return kind(r); });
say("an heir with species Array flat [optional]", () => { const a = HS.of(3, 1, 2); const r = a.flat?.(); return kind(r); });
say("an heir with species Array flat [spread]", () => { const a = HS.of(3, 1, 2); const r = a.flat(...[]); return kind(r); });
say("an heir with species Array flat [call]", () => { const a = HS.of(3, 1, 2); const r = (f => f.call(a))(a.flat); return kind(r); });
say("constructor replaced map [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.map(x => x * 2); return kind(r) + r.mine; });
say("constructor replaced map [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["map"](x => x * 2); return kind(r) + r.mine; });
say("constructor replaced map [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.map?.(x => x * 2); return kind(r) + r.mine; });
say("constructor replaced map [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.map(...[x => x * 2]); return kind(r) + r.mine; });
say("constructor replaced map [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, x => x * 2))(a.map); return kind(r) + r.mine; });
say("constructor replaced map [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.map(busy(x => x * 2)); return kind(r) + r.mine; });
say("constructor undefined map [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.map(x => x * 2); return kind(r); });
say("constructor undefined map [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["map"](x => x * 2); return kind(r); });
say("constructor undefined map [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.map?.(x => x * 2); return kind(r); });
say("constructor undefined map [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.map(...[x => x * 2]); return kind(r); });
say("constructor undefined map [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, x => x * 2))(a.map); return kind(r); });
say("constructor undefined map [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.map(busy(x => x * 2)); return kind(r); });
say("constructor a number map [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.map(x => x * 2); return kind(r); });
say("constructor a number map [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["map"](x => x * 2); return kind(r); });
say("constructor a number map [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.map?.(x => x * 2); return kind(r); });
say("constructor a number map [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.map(...[x => x * 2]); return kind(r); });
say("constructor a number map [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, x => x * 2))(a.map); return kind(r); });
say("constructor a number map [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.map(busy(x => x * 2)); return kind(r); });
say("constructor replaced filter [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.filter(x => x > 1); return kind(r) + r.mine; });
say("constructor replaced filter [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["filter"](x => x > 1); return kind(r) + r.mine; });
say("constructor replaced filter [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.filter?.(x => x > 1); return kind(r) + r.mine; });
say("constructor replaced filter [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.filter(...[x => x > 1]); return kind(r) + r.mine; });
say("constructor replaced filter [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r) + r.mine; });
say("constructor replaced filter [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.filter(busy(x => x > 1)); return kind(r) + r.mine; });
say("constructor undefined filter [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.filter(x => x > 1); return kind(r); });
say("constructor undefined filter [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["filter"](x => x > 1); return kind(r); });
say("constructor undefined filter [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.filter?.(x => x > 1); return kind(r); });
say("constructor undefined filter [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.filter(...[x => x > 1]); return kind(r); });
say("constructor undefined filter [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r); });
say("constructor undefined filter [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.filter(busy(x => x > 1)); return kind(r); });
say("constructor a number filter [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.filter(x => x > 1); return kind(r); });
say("constructor a number filter [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["filter"](x => x > 1); return kind(r); });
say("constructor a number filter [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.filter?.(x => x > 1); return kind(r); });
say("constructor a number filter [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.filter(...[x => x > 1]); return kind(r); });
say("constructor a number filter [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, x => x > 1))(a.filter); return kind(r); });
say("constructor a number filter [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.filter(busy(x => x > 1)); return kind(r); });
say("constructor replaced flatMap [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flatMap(x => [x]); return kind(r) + r.mine; });
say("constructor replaced flatMap [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["flatMap"](x => [x]); return kind(r) + r.mine; });
say("constructor replaced flatMap [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flatMap?.(x => [x]); return kind(r) + r.mine; });
say("constructor replaced flatMap [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flatMap(...[x => [x]]); return kind(r) + r.mine; });
say("constructor replaced flatMap [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, x => [x]))(a.flatMap); return kind(r) + r.mine; });
say("constructor replaced flatMap [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flatMap(busy(x => [x])); return kind(r) + r.mine; });
say("constructor undefined flatMap [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flatMap(x => [x]); return kind(r); });
say("constructor undefined flatMap [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["flatMap"](x => [x]); return kind(r); });
say("constructor undefined flatMap [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flatMap?.(x => [x]); return kind(r); });
say("constructor undefined flatMap [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flatMap(...[x => [x]]); return kind(r); });
say("constructor undefined flatMap [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, x => [x]))(a.flatMap); return kind(r); });
say("constructor undefined flatMap [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flatMap(busy(x => [x])); return kind(r); });
say("constructor a number flatMap [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flatMap(x => [x]); return kind(r); });
say("constructor a number flatMap [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["flatMap"](x => [x]); return kind(r); });
say("constructor a number flatMap [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flatMap?.(x => [x]); return kind(r); });
say("constructor a number flatMap [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flatMap(...[x => [x]]); return kind(r); });
say("constructor a number flatMap [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, x => [x]))(a.flatMap); return kind(r); });
say("constructor a number flatMap [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flatMap(busy(x => [x])); return kind(r); });
say("constructor replaced slice [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.slice(1); return kind(r) + r.mine; });
say("constructor replaced slice [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["slice"](1); return kind(r) + r.mine; });
say("constructor replaced slice [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.slice?.(1); return kind(r) + r.mine; });
say("constructor replaced slice [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.slice(...[1]); return kind(r) + r.mine; });
say("constructor replaced slice [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, 1))(a.slice); return kind(r) + r.mine; });
say("constructor replaced slice [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.slice(busy(1)); return kind(r) + r.mine; });
say("constructor undefined slice [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.slice(1); return kind(r); });
say("constructor undefined slice [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["slice"](1); return kind(r); });
say("constructor undefined slice [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.slice?.(1); return kind(r); });
say("constructor undefined slice [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.slice(...[1]); return kind(r); });
say("constructor undefined slice [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, 1))(a.slice); return kind(r); });
say("constructor undefined slice [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.slice(busy(1)); return kind(r); });
say("constructor a number slice [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.slice(1); return kind(r); });
say("constructor a number slice [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["slice"](1); return kind(r); });
say("constructor a number slice [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.slice?.(1); return kind(r); });
say("constructor a number slice [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.slice(...[1]); return kind(r); });
say("constructor a number slice [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, 1))(a.slice); return kind(r); });
say("constructor a number slice [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.slice(busy(1)); return kind(r); });
say("constructor replaced splice [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.splice(0, 1); return kind(r) + r.mine; });
say("constructor replaced splice [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["splice"](0, 1); return kind(r) + r.mine; });
say("constructor replaced splice [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.splice?.(0, 1); return kind(r) + r.mine; });
say("constructor replaced splice [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.splice(...[0, 1]); return kind(r) + r.mine; });
say("constructor replaced splice [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, 0, 1))(a.splice); return kind(r) + r.mine; });
say("constructor replaced splice [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.splice(busy(0), 1); return kind(r) + r.mine; });
say("constructor undefined splice [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.splice(0, 1); return kind(r); });
say("constructor undefined splice [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["splice"](0, 1); return kind(r); });
say("constructor undefined splice [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.splice?.(0, 1); return kind(r); });
say("constructor undefined splice [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.splice(...[0, 1]); return kind(r); });
say("constructor undefined splice [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, 0, 1))(a.splice); return kind(r); });
say("constructor undefined splice [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.splice(busy(0), 1); return kind(r); });
say("constructor a number splice [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.splice(0, 1); return kind(r); });
say("constructor a number splice [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["splice"](0, 1); return kind(r); });
say("constructor a number splice [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.splice?.(0, 1); return kind(r); });
say("constructor a number splice [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.splice(...[0, 1]); return kind(r); });
say("constructor a number splice [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, 0, 1))(a.splice); return kind(r); });
say("constructor a number splice [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.splice(busy(0), 1); return kind(r); });
say("constructor replaced concat [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.concat([9]); return kind(r) + r.mine; });
say("constructor replaced concat [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["concat"]([9]); return kind(r) + r.mine; });
say("constructor replaced concat [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.concat?.([9]); return kind(r) + r.mine; });
say("constructor replaced concat [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.concat(...[[9]]); return kind(r) + r.mine; });
say("constructor replaced concat [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a, [9]))(a.concat); return kind(r) + r.mine; });
say("constructor replaced concat [busy]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.concat(busy([9])); return kind(r) + r.mine; });
say("constructor undefined concat [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.concat([9]); return kind(r); });
say("constructor undefined concat [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["concat"]([9]); return kind(r); });
say("constructor undefined concat [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.concat?.([9]); return kind(r); });
say("constructor undefined concat [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.concat(...[[9]]); return kind(r); });
say("constructor undefined concat [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a, [9]))(a.concat); return kind(r); });
say("constructor undefined concat [busy]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.concat(busy([9])); return kind(r); });
say("constructor a number concat [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.concat([9]); return kind(r); });
say("constructor a number concat [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["concat"]([9]); return kind(r); });
say("constructor a number concat [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.concat?.([9]); return kind(r); });
say("constructor a number concat [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.concat(...[[9]]); return kind(r); });
say("constructor a number concat [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a, [9]))(a.concat); return kind(r); });
say("constructor a number concat [busy]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.concat(busy([9])); return kind(r); });
say("constructor replaced flat [direct]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flat(); return kind(r) + r.mine; });
say("constructor replaced flat [key]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a["flat"](); return kind(r) + r.mine; });
say("constructor replaced flat [optional]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flat?.(); return kind(r) + r.mine; });
say("constructor replaced flat [spread]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = a.flat(...[]); return kind(r) + r.mine; });
say("constructor replaced flat [call]", () => { const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (k) { const o = new Array(k); o.mine = true; return o; } }; const r = (f => f.call(a))(a.flat); return kind(r) + r.mine; });
say("constructor undefined flat [direct]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flat(); return kind(r); });
say("constructor undefined flat [key]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a["flat"](); return kind(r); });
say("constructor undefined flat [optional]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flat?.(); return kind(r); });
say("constructor undefined flat [spread]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = a.flat(...[]); return kind(r); });
say("constructor undefined flat [call]", () => { const a = [3, 1, 2]; a.constructor = undefined; const r = (f => f.call(a))(a.flat); return kind(r); });
say("constructor a number flat [direct]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flat(); return kind(r); });
say("constructor a number flat [key]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a["flat"](); return kind(r); });
say("constructor a number flat [optional]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flat?.(); return kind(r); });
say("constructor a number flat [spread]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = a.flat(...[]); return kind(r); });
say("constructor a number flat [call]", () => { const a = [3, 1, 2]; a.constructor = 5; const r = (f => f.call(a))(a.flat); return kind(r); });
say("toString asks for join: an heir's [direct]", () => { const a = HJ.of(1, 2); const r = a.toString(); return r; });
say("toString asks for join: an heir's [key]", () => { const a = HJ.of(1, 2); const r = a["toString"](); return r; });
say("toString asks for join: an heir's [optional]", () => { const a = HJ.of(1, 2); const r = a.toString?.(); return r; });
say("toString asks for join: an heir's [spread]", () => { const a = HJ.of(1, 2); const r = a.toString(...[]); return r; });
say("toString asks for join: an heir's [call]", () => { const a = HJ.of(1, 2); const r = (f => f.call(a))(a.toString); return r; });
say("toString asks for join: an own join [direct]", () => { const a = [1, 2]; a.join = () => "own join"; const r = a.toString(); return r; });
say("toString asks for join: an own join [key]", () => { const a = [1, 2]; a.join = () => "own join"; const r = a["toString"](); return r; });
say("toString asks for join: an own join [optional]", () => { const a = [1, 2]; a.join = () => "own join"; const r = a.toString?.(); return r; });
say("toString asks for join: an own join [spread]", () => { const a = [1, 2]; a.join = () => "own join"; const r = a.toString(...[]); return r; });
say("toString asks for join: an own join [call]", () => { const a = [1, 2]; a.join = () => "own join"; const r = (f => f.call(a))(a.toString); return r; });
say("toString asks for join: join is no function [direct]", () => { const a = [1, 2]; a.join = 5; const r = a.toString(); return r; });
say("toString asks for join: join is no function [key]", () => { const a = [1, 2]; a.join = 5; const r = a["toString"](); return r; });
say("toString asks for join: join is no function [optional]", () => { const a = [1, 2]; a.join = 5; const r = a.toString?.(); return r; });
say("toString asks for join: join is no function [spread]", () => { const a = [1, 2]; a.join = 5; const r = a.toString(...[]); return r; });
say("toString asks for join: join is no function [call]", () => { const a = [1, 2]; a.join = 5; const r = (f => f.call(a))(a.toString); return r; });
say("concat: the receiver is not spreadable [direct]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = a.concat([3]); return r.length + S(r); });
say("concat: the receiver is not spreadable [key]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = a["concat"]([3]); return r.length + S(r); });
say("concat: the receiver is not spreadable [optional]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = a.concat?.([3]); return r.length + S(r); });
say("concat: the receiver is not spreadable [spread]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = a.concat(...[[3]]); return r.length + S(r); });
say("concat: the receiver is not spreadable [call]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = (f => f.call(a, [3]))(a.concat); return r.length + S(r); });
say("concat: the receiver is not spreadable [busy]", () => { const a = [1, 2]; a[Symbol.isConcatSpreadable] = false; const r = a.concat(busy([3])); return r.length + S(r); });
say("concat: the argument is not spreadable [direct]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = a.concat(b); return r.length + S(r); });
say("concat: the argument is not spreadable [key]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = a["concat"](b); return r.length + S(r); });
say("concat: the argument is not spreadable [optional]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = a.concat?.(b); return r.length + S(r); });
say("concat: the argument is not spreadable [spread]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = a.concat(...[b]); return r.length + S(r); });
say("concat: the argument is not spreadable [call]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = (f => f.call(a, b))(a.concat); return r.length + S(r); });
say("concat: the argument is not spreadable [busy]", () => { const a = [1, 2], b = [3]; b[Symbol.isConcatSpreadable] = false; const r = a.concat(busy(b)); return r.length + S(r); });
say("concat: an array-like that is spreadable [direct]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = a.concat(b); return r.length + S(r); });
say("concat: an array-like that is spreadable [key]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = a["concat"](b); return r.length + S(r); });
say("concat: an array-like that is spreadable [optional]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = a.concat?.(b); return r.length + S(r); });
say("concat: an array-like that is spreadable [spread]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = a.concat(...[b]); return r.length + S(r); });
say("concat: an array-like that is spreadable [call]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = (f => f.call(a, b))(a.concat); return r.length + S(r); });
say("concat: an array-like that is spreadable [busy]", () => { const a = [1, 2], b = { length: 1, 0: 3, [Symbol.isConcatSpreadable]: true }; const r = a.concat(busy(b)); return r.length + S(r); });
say("concat: an heir as the argument [direct]", () => { const a = [1, 2], b = H.of(3); const r = a.concat(b); return kind(r); });
say("concat: an heir as the argument [key]", () => { const a = [1, 2], b = H.of(3); const r = a["concat"](b); return kind(r); });
say("concat: an heir as the argument [optional]", () => { const a = [1, 2], b = H.of(3); const r = a.concat?.(b); return kind(r); });
say("concat: an heir as the argument [spread]", () => { const a = [1, 2], b = H.of(3); const r = a.concat(...[b]); return kind(r); });
say("concat: an heir as the argument [call]", () => { const a = [1, 2], b = H.of(3); const r = (f => f.call(a, b))(a.concat); return kind(r); });
say("concat: an heir as the argument [busy]", () => { const a = [1, 2], b = H.of(3); const r = a.concat(busy(b)); return kind(r); });
say("a hole over an heir's prototype includes [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.includes("inherited"); return r; });
say("a hole over an heir's prototype includes [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["includes"]("inherited"); return r; });
say("a hole over an heir's prototype includes [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.includes?.("inherited"); return r; });
say("a hole over an heir's prototype includes [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.includes(...["inherited"]); return r; });
say("a hole over an heir's prototype includes [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a, "inherited"))(a.includes); return r; });
say("a hole over an heir's prototype includes [busy]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.includes(busy("inherited")); return r; });
say("an accessor element includes [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.includes("inherited"); return r; });
say("an accessor element includes [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["includes"]("inherited"); return r; });
say("an accessor element includes [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.includes?.("inherited"); return r; });
say("an accessor element includes [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.includes(...["inherited"]); return r; });
say("an accessor element includes [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a, "inherited"))(a.includes); return r; });
say("an accessor element includes [busy]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.includes(busy("inherited")); return r; });
say("a hole over an heir's prototype indexOf [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.indexOf("inherited"); return r; });
say("a hole over an heir's prototype indexOf [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["indexOf"]("inherited"); return r; });
say("a hole over an heir's prototype indexOf [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.indexOf?.("inherited"); return r; });
say("a hole over an heir's prototype indexOf [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.indexOf(...["inherited"]); return r; });
say("a hole over an heir's prototype indexOf [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a, "inherited"))(a.indexOf); return r; });
say("a hole over an heir's prototype indexOf [busy]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.indexOf(busy("inherited")); return r; });
say("an accessor element indexOf [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.indexOf("inherited"); return r; });
say("an accessor element indexOf [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["indexOf"]("inherited"); return r; });
say("an accessor element indexOf [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.indexOf?.("inherited"); return r; });
say("an accessor element indexOf [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.indexOf(...["inherited"]); return r; });
say("an accessor element indexOf [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a, "inherited"))(a.indexOf); return r; });
say("an accessor element indexOf [busy]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.indexOf(busy("inherited")); return r; });
say("a hole over an heir's prototype at [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.at(1); return r; });
say("a hole over an heir's prototype at [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["at"](1); return r; });
say("a hole over an heir's prototype at [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.at?.(1); return r; });
say("a hole over an heir's prototype at [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.at(...[1]); return r; });
say("a hole over an heir's prototype at [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a, 1))(a.at); return r; });
say("a hole over an heir's prototype at [busy]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.at(busy(1)); return r; });
say("an accessor element at [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.at(1); return r; });
say("an accessor element at [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["at"](1); return r; });
say("an accessor element at [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.at?.(1); return r; });
say("an accessor element at [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.at(...[1]); return r; });
say("an accessor element at [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a, 1))(a.at); return r; });
say("an accessor element at [busy]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.at(busy(1)); return r; });
say("a hole over an heir's prototype join [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.join("-"); return r; });
say("a hole over an heir's prototype join [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["join"]("-"); return r; });
say("a hole over an heir's prototype join [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.join?.("-"); return r; });
say("a hole over an heir's prototype join [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.join(...["-"]); return r; });
say("a hole over an heir's prototype join [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a, "-"))(a.join); return r; });
say("a hole over an heir's prototype join [busy]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.join(busy("-")); return r; });
say("an accessor element join [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.join("-"); return r; });
say("an accessor element join [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["join"]("-"); return r; });
say("an accessor element join [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.join?.("-"); return r; });
say("an accessor element join [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.join(...["-"]); return r; });
say("an accessor element join [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a, "-"))(a.join); return r; });
say("an accessor element join [busy]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.join(busy("-")); return r; });
say("a hole over an heir's prototype pop [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.pop(); return r + S(a); });
say("a hole over an heir's prototype pop [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["pop"](); return r + S(a); });
say("a hole over an heir's prototype pop [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.pop?.(); return r + S(a); });
say("a hole over an heir's prototype pop [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.pop(...[]); return r + S(a); });
say("a hole over an heir's prototype pop [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a))(a.pop); return r + S(a); });
say("an accessor element pop [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.pop(); return r + S(a); });
say("an accessor element pop [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["pop"](); return r + S(a); });
say("an accessor element pop [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.pop?.(); return r + S(a); });
say("an accessor element pop [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.pop(...[]); return r + S(a); });
say("an accessor element pop [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a))(a.pop); return r + S(a); });
say("a hole over an heir's prototype shift [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.shift(); return r + S(a); });
say("a hole over an heir's prototype shift [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["shift"](); return r + S(a); });
say("a hole over an heir's prototype shift [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.shift?.(); return r + S(a); });
say("a hole over an heir's prototype shift [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.shift(...[]); return r + S(a); });
say("a hole over an heir's prototype shift [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a))(a.shift); return r + S(a); });
say("an accessor element shift [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.shift(); return r + S(a); });
say("an accessor element shift [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["shift"](); return r + S(a); });
say("an accessor element shift [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.shift?.(); return r + S(a); });
say("an accessor element shift [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.shift(...[]); return r + S(a); });
say("an accessor element shift [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a))(a.shift); return r + S(a); });
say("a hole over an heir's prototype lastIndexOf [direct]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.lastIndexOf("inherited"); return r; });
say("a hole over an heir's prototype lastIndexOf [key]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a["lastIndexOf"]("inherited"); return r; });
say("a hole over an heir's prototype lastIndexOf [optional]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.lastIndexOf?.("inherited"); return r; });
say("a hole over an heir's prototype lastIndexOf [spread]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.lastIndexOf(...["inherited"]); return r; });
say("a hole over an heir's prototype lastIndexOf [call]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = (f => f.call(a, "inherited"))(a.lastIndexOf); return r; });
say("a hole over an heir's prototype lastIndexOf [busy]", () => { class HP extends Array {} HP.prototype[1] = "inherited"; const a = new HP(2); a[0] = "own"; const r = a.lastIndexOf(busy("inherited")); return r; });
say("an accessor element lastIndexOf [direct]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.lastIndexOf("inherited"); return r; });
say("an accessor element lastIndexOf [key]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a["lastIndexOf"]("inherited"); return r; });
say("an accessor element lastIndexOf [optional]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.lastIndexOf?.("inherited"); return r; });
say("an accessor element lastIndexOf [spread]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.lastIndexOf(...["inherited"]); return r; });
say("an accessor element lastIndexOf [call]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = (f => f.call(a, "inherited"))(a.lastIndexOf); return r; });
say("an accessor element lastIndexOf [busy]", () => { const a = ["own", 0]; Object.defineProperty(a, 1, { get() { return "inherited"; }, configurable: true }); const r = a.lastIndexOf(busy("inherited")); return r; });
say("frozen push [direct]", () => { const a = Object.freeze([1, 2]); const r = a.push(9); return r + S(a); });
say("frozen push [key]", () => { const a = Object.freeze([1, 2]); const r = a["push"](9); return r + S(a); });
say("frozen push [optional]", () => { const a = Object.freeze([1, 2]); const r = a.push?.(9); return r + S(a); });
say("frozen push [spread]", () => { const a = Object.freeze([1, 2]); const r = a.push(...[9]); return r + S(a); });
say("frozen push [call]", () => { const a = Object.freeze([1, 2]); const r = (f => f.call(a, 9))(a.push); return r + S(a); });
say("frozen push [busy]", () => { const a = Object.freeze([1, 2]); const r = a.push(busy(9)); return r + S(a); });
say("length read-only push [direct]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.push(9); return r + S(a); });
say("length read-only push [key]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a["push"](9); return r + S(a); });
say("length read-only push [optional]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.push?.(9); return r + S(a); });
say("length read-only push [spread]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.push(...[9]); return r + S(a); });
say("length read-only push [call]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = (f => f.call(a, 9))(a.push); return r + S(a); });
say("length read-only push [busy]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.push(busy(9)); return r + S(a); });
say("an heir push [direct]", () => { const a = H.of(1, 2); const r = a.push(9); return S(r) + kind(a); });
say("an heir push [key]", () => { const a = H.of(1, 2); const r = a["push"](9); return S(r) + kind(a); });
say("an heir push [optional]", () => { const a = H.of(1, 2); const r = a.push?.(9); return S(r) + kind(a); });
say("an heir push [spread]", () => { const a = H.of(1, 2); const r = a.push(...[9]); return S(r) + kind(a); });
say("an heir push [call]", () => { const a = H.of(1, 2); const r = (f => f.call(a, 9))(a.push); return S(r) + kind(a); });
say("an heir push [busy]", () => { const a = H.of(1, 2); const r = a.push(busy(9)); return S(r) + kind(a); });
say("frozen unshift [direct]", () => { const a = Object.freeze([1, 2]); const r = a.unshift(9); return r + S(a); });
say("frozen unshift [key]", () => { const a = Object.freeze([1, 2]); const r = a["unshift"](9); return r + S(a); });
say("frozen unshift [optional]", () => { const a = Object.freeze([1, 2]); const r = a.unshift?.(9); return r + S(a); });
say("frozen unshift [spread]", () => { const a = Object.freeze([1, 2]); const r = a.unshift(...[9]); return r + S(a); });
say("frozen unshift [call]", () => { const a = Object.freeze([1, 2]); const r = (f => f.call(a, 9))(a.unshift); return r + S(a); });
say("frozen unshift [busy]", () => { const a = Object.freeze([1, 2]); const r = a.unshift(busy(9)); return r + S(a); });
say("length read-only unshift [direct]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.unshift(9); return r + S(a); });
say("length read-only unshift [key]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a["unshift"](9); return r + S(a); });
say("length read-only unshift [optional]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.unshift?.(9); return r + S(a); });
say("length read-only unshift [spread]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.unshift(...[9]); return r + S(a); });
say("length read-only unshift [call]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = (f => f.call(a, 9))(a.unshift); return r + S(a); });
say("length read-only unshift [busy]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.unshift(busy(9)); return r + S(a); });
say("an heir unshift [direct]", () => { const a = H.of(1, 2); const r = a.unshift(9); return S(r) + kind(a); });
say("an heir unshift [key]", () => { const a = H.of(1, 2); const r = a["unshift"](9); return S(r) + kind(a); });
say("an heir unshift [optional]", () => { const a = H.of(1, 2); const r = a.unshift?.(9); return S(r) + kind(a); });
say("an heir unshift [spread]", () => { const a = H.of(1, 2); const r = a.unshift(...[9]); return S(r) + kind(a); });
say("an heir unshift [call]", () => { const a = H.of(1, 2); const r = (f => f.call(a, 9))(a.unshift); return S(r) + kind(a); });
say("an heir unshift [busy]", () => { const a = H.of(1, 2); const r = a.unshift(busy(9)); return S(r) + kind(a); });
say("frozen pop [direct]", () => { const a = Object.freeze([1, 2]); const r = a.pop(); return r + S(a); });
say("frozen pop [key]", () => { const a = Object.freeze([1, 2]); const r = a["pop"](); return r + S(a); });
say("frozen pop [optional]", () => { const a = Object.freeze([1, 2]); const r = a.pop?.(); return r + S(a); });
say("frozen pop [spread]", () => { const a = Object.freeze([1, 2]); const r = a.pop(...[]); return r + S(a); });
say("frozen pop [call]", () => { const a = Object.freeze([1, 2]); const r = (f => f.call(a))(a.pop); return r + S(a); });
say("length read-only pop [direct]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.pop(); return r + S(a); });
say("length read-only pop [key]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a["pop"](); return r + S(a); });
say("length read-only pop [optional]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.pop?.(); return r + S(a); });
say("length read-only pop [spread]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.pop(...[]); return r + S(a); });
say("length read-only pop [call]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = (f => f.call(a))(a.pop); return r + S(a); });
say("an heir pop [direct]", () => { const a = H.of(1, 2); const r = a.pop(); return S(r) + kind(a); });
say("an heir pop [key]", () => { const a = H.of(1, 2); const r = a["pop"](); return S(r) + kind(a); });
say("an heir pop [optional]", () => { const a = H.of(1, 2); const r = a.pop?.(); return S(r) + kind(a); });
say("an heir pop [spread]", () => { const a = H.of(1, 2); const r = a.pop(...[]); return S(r) + kind(a); });
say("an heir pop [call]", () => { const a = H.of(1, 2); const r = (f => f.call(a))(a.pop); return S(r) + kind(a); });
say("frozen shift [direct]", () => { const a = Object.freeze([1, 2]); const r = a.shift(); return r + S(a); });
say("frozen shift [key]", () => { const a = Object.freeze([1, 2]); const r = a["shift"](); return r + S(a); });
say("frozen shift [optional]", () => { const a = Object.freeze([1, 2]); const r = a.shift?.(); return r + S(a); });
say("frozen shift [spread]", () => { const a = Object.freeze([1, 2]); const r = a.shift(...[]); return r + S(a); });
say("frozen shift [call]", () => { const a = Object.freeze([1, 2]); const r = (f => f.call(a))(a.shift); return r + S(a); });
say("length read-only shift [direct]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.shift(); return r + S(a); });
say("length read-only shift [key]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a["shift"](); return r + S(a); });
say("length read-only shift [optional]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.shift?.(); return r + S(a); });
say("length read-only shift [spread]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.shift(...[]); return r + S(a); });
say("length read-only shift [call]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = (f => f.call(a))(a.shift); return r + S(a); });
say("an heir shift [direct]", () => { const a = H.of(1, 2); const r = a.shift(); return S(r) + kind(a); });
say("an heir shift [key]", () => { const a = H.of(1, 2); const r = a["shift"](); return S(r) + kind(a); });
say("an heir shift [optional]", () => { const a = H.of(1, 2); const r = a.shift?.(); return S(r) + kind(a); });
say("an heir shift [spread]", () => { const a = H.of(1, 2); const r = a.shift(...[]); return S(r) + kind(a); });
say("an heir shift [call]", () => { const a = H.of(1, 2); const r = (f => f.call(a))(a.shift); return S(r) + kind(a); });
say("frozen splice [direct]", () => { const a = Object.freeze([1, 2]); const r = a.splice(0, 1); return r + S(a); });
say("frozen splice [key]", () => { const a = Object.freeze([1, 2]); const r = a["splice"](0, 1); return r + S(a); });
say("frozen splice [optional]", () => { const a = Object.freeze([1, 2]); const r = a.splice?.(0, 1); return r + S(a); });
say("frozen splice [spread]", () => { const a = Object.freeze([1, 2]); const r = a.splice(...[0, 1]); return r + S(a); });
say("frozen splice [call]", () => { const a = Object.freeze([1, 2]); const r = (f => f.call(a, 0, 1))(a.splice); return r + S(a); });
say("frozen splice [busy]", () => { const a = Object.freeze([1, 2]); const r = a.splice(busy(0), 1); return r + S(a); });
say("length read-only splice [direct]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.splice(0, 1); return r + S(a); });
say("length read-only splice [key]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a["splice"](0, 1); return r + S(a); });
say("length read-only splice [optional]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.splice?.(0, 1); return r + S(a); });
say("length read-only splice [spread]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.splice(...[0, 1]); return r + S(a); });
say("length read-only splice [call]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = (f => f.call(a, 0, 1))(a.splice); return r + S(a); });
say("length read-only splice [busy]", () => { const a = [1, 2]; Object.defineProperty(a, "length", { writable: false }); const r = a.splice(busy(0), 1); return r + S(a); });
say("an heir splice [direct]", () => { const a = H.of(1, 2); const r = a.splice(0, 1); return S(r) + kind(a); });
say("an heir splice [key]", () => { const a = H.of(1, 2); const r = a["splice"](0, 1); return S(r) + kind(a); });
say("an heir splice [optional]", () => { const a = H.of(1, 2); const r = a.splice?.(0, 1); return S(r) + kind(a); });
say("an heir splice [spread]", () => { const a = H.of(1, 2); const r = a.splice(...[0, 1]); return S(r) + kind(a); });
say("an heir splice [call]", () => { const a = H.of(1, 2); const r = (f => f.call(a, 0, 1))(a.splice); return S(r) + kind(a); });
say("an heir splice [busy]", () => { const a = H.of(1, 2); const r = a.splice(busy(0), 1); return S(r) + kind(a); });
say("push: a setter on the heir's prototype [direct]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = a.push(9); return r + log.join() + a[0]; });
say("push: a setter on the heir's prototype [key]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = a["push"](9); return r + log.join() + a[0]; });
say("push: a setter on the heir's prototype [optional]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = a.push?.(9); return r + log.join() + a[0]; });
say("push: a setter on the heir's prototype [spread]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = a.push(...[9]); return r + log.join() + a[0]; });
say("push: a setter on the heir's prototype [call]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = (f => f.call(a, 9))(a.push); return r + log.join() + a[0]; });
say("push: a setter on the heir's prototype [busy]", () => { const log = []; class HP extends Array {} Object.defineProperty(HP.prototype, 0, { set(v) { log.push("set " + v); }, get() { return "got"; } }); const a = new HP(); const r = a.push(busy(9)); return r + log.join() + a[0]; });
say("H.of [direct]", () => { HC.made = 0; const r = H.of(1, 2); return kind(r) + r instanceof H; });
say("H.of [key]", () => { HC.made = 0; const r = H["of"](1, 2); return kind(r) + r instanceof H; });
say("H.of [optional]", () => { HC.made = 0; const r = H.of?.(1, 2); return kind(r) + r instanceof H; });
say("H.of [spread]", () => { HC.made = 0; const r = H.of(...[1, 2]); return kind(r) + r instanceof H; });
say("H.of [call]", () => { HC.made = 0; const r = (f => f.call(H, 1, 2))(H.of); return kind(r) + r instanceof H; });
say("H.of [busy]", () => { HC.made = 0; const r = H.of(busy(1), 2); return kind(r) + r instanceof H; });
say("H.from an array [direct]", () => { HC.made = 0; const r = H.from([1, 2]); return kind(r) + r instanceof H; });
say("H.from an array [key]", () => { HC.made = 0; const r = H["from"]([1, 2]); return kind(r) + r instanceof H; });
say("H.from an array [optional]", () => { HC.made = 0; const r = H.from?.([1, 2]); return kind(r) + r instanceof H; });
say("H.from an array [spread]", () => { HC.made = 0; const r = H.from(...[[1, 2]]); return kind(r) + r instanceof H; });
say("H.from an array [call]", () => { HC.made = 0; const r = (f => f.call(H, [1, 2]))(H.from); return kind(r) + r instanceof H; });
say("H.from an array [busy]", () => { HC.made = 0; const r = H.from(busy([1, 2])); return kind(r) + r instanceof H; });
say("H.from with a function [direct]", () => { HC.made = 0; const r = H.from([1, 2], x => x * 2); return kind(r) + r instanceof H; });
say("H.from with a function [key]", () => { HC.made = 0; const r = H["from"]([1, 2], x => x * 2); return kind(r) + r instanceof H; });
say("H.from with a function [optional]", () => { HC.made = 0; const r = H.from?.([1, 2], x => x * 2); return kind(r) + r instanceof H; });
say("H.from with a function [spread]", () => { HC.made = 0; const r = H.from(...[[1, 2], x => x * 2]); return kind(r) + r instanceof H; });
say("H.from with a function [call]", () => { HC.made = 0; const r = (f => f.call(H, [1, 2], x => x * 2))(H.from); return kind(r) + r instanceof H; });
say("H.from with a function [busy]", () => { HC.made = 0; const r = H.from(busy([1, 2]), x => x * 2); return kind(r) + r instanceof H; });
say("H.from a length [direct]", () => { HC.made = 0; const r = H.from({ length: 2 }); return kind(r) + r instanceof H; });
say("H.from a length [key]", () => { HC.made = 0; const r = H["from"]({ length: 2 }); return kind(r) + r instanceof H; });
say("H.from a length [optional]", () => { HC.made = 0; const r = H.from?.({ length: 2 }); return kind(r) + r instanceof H; });
say("H.from a length [spread]", () => { HC.made = 0; const r = H.from(...[{ length: 2 }]); return kind(r) + r instanceof H; });
say("H.from a length [call]", () => { HC.made = 0; const r = (f => f.call(H, { length: 2 }))(H.from); return kind(r) + r instanceof H; });
say("H.from a length [busy]", () => { HC.made = 0; const r = H.from(busy({ length: 2 })); return kind(r) + r instanceof H; });
say("HC.of [direct]", () => { HC.made = 0; const r = HC.of(1, 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.of [key]", () => { HC.made = 0; const r = HC["of"](1, 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.of [optional]", () => { HC.made = 0; const r = HC.of?.(1, 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.of [spread]", () => { HC.made = 0; const r = HC.of(...[1, 2]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.of [call]", () => { HC.made = 0; const r = (f => f.call(HC, 1, 2))(HC.of); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.of [busy]", () => { HC.made = 0; const r = HC.of(busy(1), 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [direct]", () => { HC.made = 0; const r = HC.from([1, 2]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [key]", () => { HC.made = 0; const r = HC["from"]([1, 2]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [optional]", () => { HC.made = 0; const r = HC.from?.([1, 2]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [spread]", () => { HC.made = 0; const r = HC.from(...[[1, 2]]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [call]", () => { HC.made = 0; const r = (f => f.call(HC, [1, 2]))(HC.from); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from an array [busy]", () => { HC.made = 0; const r = HC.from(busy([1, 2])); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [direct]", () => { HC.made = 0; const r = HC.from([1, 2], x => x * 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [key]", () => { HC.made = 0; const r = HC["from"]([1, 2], x => x * 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [optional]", () => { HC.made = 0; const r = HC.from?.([1, 2], x => x * 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [spread]", () => { HC.made = 0; const r = HC.from(...[[1, 2], x => x * 2]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [call]", () => { HC.made = 0; const r = (f => f.call(HC, [1, 2], x => x * 2))(HC.from); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from with a function [busy]", () => { HC.made = 0; const r = HC.from(busy([1, 2]), x => x * 2); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [direct]", () => { HC.made = 0; const r = HC.from({ length: 2 }); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [key]", () => { HC.made = 0; const r = HC["from"]({ length: 2 }); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [optional]", () => { HC.made = 0; const r = HC.from?.({ length: 2 }); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [spread]", () => { HC.made = 0; const r = HC.from(...[{ length: 2 }]); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [call]", () => { HC.made = 0; const r = (f => f.call(HC, { length: 2 }))(HC.from); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("HC.from a length [busy]", () => { HC.made = 0; const r = HC.from(busy({ length: 2 })); return kind(r) + (r instanceof HC) + " made " + HC.made; });
say("U8.of [direct]", () => { HC.made = 0; const r = U8.of(1, 2); return kind(r) + r instanceof U8; });
say("U8.of [key]", () => { HC.made = 0; const r = U8["of"](1, 2); return kind(r) + r instanceof U8; });
say("U8.of [optional]", () => { HC.made = 0; const r = U8.of?.(1, 2); return kind(r) + r instanceof U8; });
say("U8.of [spread]", () => { HC.made = 0; const r = U8.of(...[1, 2]); return kind(r) + r instanceof U8; });
say("U8.of [call]", () => { HC.made = 0; const r = (f => f.call(U8, 1, 2))(U8.of); return kind(r) + r instanceof U8; });
say("U8.of [busy]", () => { HC.made = 0; const r = U8.of(busy(1), 2); return kind(r) + r instanceof U8; });
say("U8.from an array [direct]", () => { HC.made = 0; const r = U8.from([1, 2]); return kind(r) + r instanceof U8; });
say("U8.from an array [key]", () => { HC.made = 0; const r = U8["from"]([1, 2]); return kind(r) + r instanceof U8; });
say("U8.from an array [optional]", () => { HC.made = 0; const r = U8.from?.([1, 2]); return kind(r) + r instanceof U8; });
say("U8.from an array [spread]", () => { HC.made = 0; const r = U8.from(...[[1, 2]]); return kind(r) + r instanceof U8; });
say("U8.from an array [call]", () => { HC.made = 0; const r = (f => f.call(U8, [1, 2]))(U8.from); return kind(r) + r instanceof U8; });
say("U8.from an array [busy]", () => { HC.made = 0; const r = U8.from(busy([1, 2])); return kind(r) + r instanceof U8; });
say("U8.from with a function [direct]", () => { HC.made = 0; const r = U8.from([1, 2], x => x * 2); return kind(r) + r instanceof U8; });
say("U8.from with a function [key]", () => { HC.made = 0; const r = U8["from"]([1, 2], x => x * 2); return kind(r) + r instanceof U8; });
say("U8.from with a function [optional]", () => { HC.made = 0; const r = U8.from?.([1, 2], x => x * 2); return kind(r) + r instanceof U8; });
say("U8.from with a function [spread]", () => { HC.made = 0; const r = U8.from(...[[1, 2], x => x * 2]); return kind(r) + r instanceof U8; });
say("U8.from with a function [call]", () => { HC.made = 0; const r = (f => f.call(U8, [1, 2], x => x * 2))(U8.from); return kind(r) + r instanceof U8; });
say("U8.from with a function [busy]", () => { HC.made = 0; const r = U8.from(busy([1, 2]), x => x * 2); return kind(r) + r instanceof U8; });
say("U8.from a length [direct]", () => { HC.made = 0; const r = U8.from({ length: 2 }); return kind(r) + r instanceof U8; });
say("U8.from a length [key]", () => { HC.made = 0; const r = U8["from"]({ length: 2 }); return kind(r) + r instanceof U8; });
say("U8.from a length [optional]", () => { HC.made = 0; const r = U8.from?.({ length: 2 }); return kind(r) + r instanceof U8; });
say("U8.from a length [spread]", () => { HC.made = 0; const r = U8.from(...[{ length: 2 }]); return kind(r) + r instanceof U8; });
say("U8.from a length [call]", () => { HC.made = 0; const r = (f => f.call(U8, { length: 2 }))(U8.from); return kind(r) + r instanceof U8; });
say("U8.from a length [busy]", () => { HC.made = 0; const r = U8.from(busy({ length: 2 })); return kind(r) + r instanceof U8; });
say("of on a plain constructor [direct]", () => { function K(n) { this.n = n; } const r = ({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }).of(1, 2); return r.constructor.name + S(r); });
say("of on a plain constructor [key]", () => { function K(n) { this.n = n; } const r = ({ of: Array.of, K }).K && Object.assign(K, { of: Array.of })["of"](1, 2); return r.constructor.name + S(r); });
say("of on a plain constructor [optional]", () => { function K(n) { this.n = n; } const r = ({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }).of?.(1, 2); return r.constructor.name + S(r); });
say("of on a plain constructor [spread]", () => { function K(n) { this.n = n; } const r = ({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }).of(...[1, 2]); return r.constructor.name + S(r); });
say("of on a plain constructor [call]", () => { function K(n) { this.n = n; } const r = (f => f.call(({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }), 1, 2))(({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }).of); return r.constructor.name + S(r); });
say("of on a plain constructor [busy]", () => { function K(n) { this.n = n; } const r = ({ of: Array.of, K }).K && Object.assign(K, { of: Array.of }).of(busy(1), 2); return r.constructor.name + S(r); });
say("from on a plain constructor [direct]", () => { function K(n) { this.n = n; } const r = Object.assign(K, { from: Array.from }).from([1, 2]); return r.constructor.name + S(r); });
say("from on a plain constructor [key]", () => { function K(n) { this.n = n; } const r = Object.assign(K, { from: Array.from })["from"]([1, 2]); return r.constructor.name + S(r); });
say("from on a plain constructor [optional]", () => { function K(n) { this.n = n; } const r = Object.assign(K, { from: Array.from }).from?.([1, 2]); return r.constructor.name + S(r); });
say("from on a plain constructor [spread]", () => { function K(n) { this.n = n; } const r = Object.assign(K, { from: Array.from }).from(...[[1, 2]]); return r.constructor.name + S(r); });
say("from on a plain constructor [call]", () => { function K(n) { this.n = n; } const r = (f => f.call(Object.assign(K, { from: Array.from }), [1, 2]))(Object.assign(K, { from: Array.from }).from); return r.constructor.name + S(r); });
say("from on a plain constructor [busy]", () => { function K(n) { this.n = n; } const r = Object.assign(K, { from: Array.from }).from(busy([1, 2])); return r.constructor.name + S(r); });
say("of on an object that is no constructor [direct]", () => {  const r = ({ of: Array.of }).of(1, 2); return kind(r); });
say("of on an object that is no constructor [key]", () => {  const r = ({ of: Array.of })["of"](1, 2); return kind(r); });
say("of on an object that is no constructor [optional]", () => {  const r = ({ of: Array.of }).of?.(1, 2); return kind(r); });
say("of on an object that is no constructor [spread]", () => {  const r = ({ of: Array.of }).of(...[1, 2]); return kind(r); });
say("of on an object that is no constructor [call]", () => {  const r = (f => f.call(({ of: Array.of }), 1, 2))(({ of: Array.of }).of); return kind(r); });
say("of on an object that is no constructor [busy]", () => {  const r = ({ of: Array.of }).of(busy(1), 2); return kind(r); });
say("P2.resolve [direct]", () => { P2.made = 0; const r = P2.resolve(1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve [key]", () => { P2.made = 0; const r = P2["resolve"](1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve [optional]", () => { P2.made = 0; const r = P2.resolve?.(1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve [spread]", () => { P2.made = 0; const r = P2.resolve(...[1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve [call]", () => { P2.made = 0; const r = (f => f.call(P2, 1))(P2.resolve); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve [busy]", () => { P2.made = 0; const r = P2.resolve(busy(1)); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [direct]", () => { P2.made = 0; const r = P2.reject(1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [key]", () => { P2.made = 0; const r = P2["reject"](1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [optional]", () => { P2.made = 0; const r = P2.reject?.(1); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [spread]", () => { P2.made = 0; const r = P2.reject(...[1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [call]", () => { P2.made = 0; const r = (f => f.call(P2, 1))(P2.reject); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.reject [busy]", () => { P2.made = 0; const r = P2.reject(busy(1)); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [direct]", () => { P2.made = 0; const r = P2.all([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [key]", () => { P2.made = 0; const r = P2["all"]([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [optional]", () => { P2.made = 0; const r = P2.all?.([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [spread]", () => { P2.made = 0; const r = P2.all(...[[1]]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [call]", () => { P2.made = 0; const r = (f => f.call(P2, [1]))(P2.all); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.all [busy]", () => { P2.made = 0; const r = P2.all(busy([1])); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [direct]", () => { P2.made = 0; const r = P2.allSettled([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [key]", () => { P2.made = 0; const r = P2["allSettled"]([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [optional]", () => { P2.made = 0; const r = P2.allSettled?.([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [spread]", () => { P2.made = 0; const r = P2.allSettled(...[[1]]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [call]", () => { P2.made = 0; const r = (f => f.call(P2, [1]))(P2.allSettled); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.allSettled [busy]", () => { P2.made = 0; const r = P2.allSettled(busy([1])); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [direct]", () => { P2.made = 0; const r = P2.race([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [key]", () => { P2.made = 0; const r = P2["race"]([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [optional]", () => { P2.made = 0; const r = P2.race?.([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [spread]", () => { P2.made = 0; const r = P2.race(...[[1]]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [call]", () => { P2.made = 0; const r = (f => f.call(P2, [1]))(P2.race); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.race [busy]", () => { P2.made = 0; const r = P2.race(busy([1])); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [direct]", () => { P2.made = 0; const r = P2.any([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [key]", () => { P2.made = 0; const r = P2["any"]([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [optional]", () => { P2.made = 0; const r = P2.any?.([1]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [spread]", () => { P2.made = 0; const r = P2.any(...[[1]]); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [call]", () => { P2.made = 0; const r = (f => f.call(P2, [1]))(P2.any); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.any [busy]", () => { P2.made = 0; const r = P2.any(busy([1])); return (r.catch(() => {}), kind(r) + (r instanceof P2) + " made " + (P2.made > 0) + " " + typeof r.extra); });
say("P2.resolve of a plain promise [direct]", () => { const p = Promise.resolve(1); const r = P2.resolve(p); return kind(r) + (r === p); });
say("P2.resolve of a plain promise [key]", () => { const p = Promise.resolve(1); const r = P2["resolve"](p); return kind(r) + (r === p); });
say("P2.resolve of a plain promise [optional]", () => { const p = Promise.resolve(1); const r = P2.resolve?.(p); return kind(r) + (r === p); });
say("P2.resolve of a plain promise [spread]", () => { const p = Promise.resolve(1); const r = P2.resolve(...[p]); return kind(r) + (r === p); });
say("P2.resolve of a plain promise [call]", () => { const p = Promise.resolve(1); const r = (f => f.call(P2, p))(P2.resolve); return kind(r) + (r === p); });
say("P2.resolve of a plain promise [busy]", () => { const p = Promise.resolve(1); const r = P2.resolve(busy(p)); return kind(r) + (r === p); });
say("P2.resolve of a P2 [direct]", () => { const p = P2.resolve(1); const r = P2.resolve(p); return kind(r) + (r === p); });
say("P2.resolve of a P2 [key]", () => { const p = P2.resolve(1); const r = P2["resolve"](p); return kind(r) + (r === p); });
say("P2.resolve of a P2 [optional]", () => { const p = P2.resolve(1); const r = P2.resolve?.(p); return kind(r) + (r === p); });
say("P2.resolve of a P2 [spread]", () => { const p = P2.resolve(1); const r = P2.resolve(...[p]); return kind(r) + (r === p); });
say("P2.resolve of a P2 [call]", () => { const p = P2.resolve(1); const r = (f => f.call(P2, p))(P2.resolve); return kind(r) + (r === p); });
say("P2.resolve of a P2 [busy]", () => { const p = P2.resolve(1); const r = P2.resolve(busy(p)); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [direct]", () => { const p = P2.resolve(1); const r = Promise.resolve(p); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [key]", () => { const p = P2.resolve(1); const r = Promise["resolve"](p); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [optional]", () => { const p = P2.resolve(1); const r = Promise.resolve?.(p); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [spread]", () => { const p = P2.resolve(1); const r = Promise.resolve(...[p]); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [call]", () => { const p = P2.resolve(1); const r = (f => f.call(Promise, p))(Promise.resolve); return kind(r) + (r === p); });
say("Promise.resolve of a P2 [busy]", () => { const p = P2.resolve(1); const r = Promise.resolve(busy(p)); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [direct]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = Promise.resolve(p); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [key]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = Promise["resolve"](p); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [optional]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = Promise.resolve?.(p); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [spread]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = Promise.resolve(...[p]); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [call]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = (f => f.call(Promise, p))(Promise.resolve); return kind(r) + (r === p); });
say("Promise.resolve of a promise whose constructor is replaced [busy]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = Promise.resolve(busy(p)); return kind(r) + (r === p); });
say("resolve on a plain constructor [direct]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = Object.assign(K, { resolve: Promise.resolve }).resolve(5); return r.constructor.name + r.v; });
say("resolve on a plain constructor [key]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = Object.assign(K, { resolve: Promise.resolve })["resolve"](5); return r.constructor.name + r.v; });
say("resolve on a plain constructor [optional]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = Object.assign(K, { resolve: Promise.resolve }).resolve?.(5); return r.constructor.name + r.v; });
say("resolve on a plain constructor [spread]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = Object.assign(K, { resolve: Promise.resolve }).resolve(...[5]); return r.constructor.name + r.v; });
say("resolve on a plain constructor [call]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = (f => f.call(Object.assign(K, { resolve: Promise.resolve }), 5))(Object.assign(K, { resolve: Promise.resolve }).resolve); return r.constructor.name + r.v; });
say("resolve on a plain constructor [busy]", () => { function K(f) { f(v => { this.v = v; }, () => {}); } const r = Object.assign(K, { resolve: Promise.resolve }).resolve(busy(5)); return r.constructor.name + r.v; });
say("resolve on what is no constructor [direct]", () => {  const r = ({ resolve: Promise.resolve }).resolve(5); return kind(r); });
say("resolve on what is no constructor [key]", () => {  const r = ({ resolve: Promise.resolve })["resolve"](5); return kind(r); });
say("resolve on what is no constructor [optional]", () => {  const r = ({ resolve: Promise.resolve }).resolve?.(5); return kind(r); });
say("resolve on what is no constructor [spread]", () => {  const r = ({ resolve: Promise.resolve }).resolve(...[5]); return kind(r); });
say("resolve on what is no constructor [call]", () => {  const r = (f => f.call(({ resolve: Promise.resolve }), 5))(({ resolve: Promise.resolve }).resolve); return kind(r); });
say("resolve on what is no constructor [busy]", () => {  const r = ({ resolve: Promise.resolve }).resolve(busy(5)); return kind(r); });
say("P2 then [direct]", () => { const p = P2.resolve(1); const r = p.then(x => x); return kind(r) + typeof r.extra; });
say("P2 then [key]", () => { const p = P2.resolve(1); const r = p["then"](x => x); return kind(r) + typeof r.extra; });
say("P2 then [optional]", () => { const p = P2.resolve(1); const r = p.then?.(x => x); return kind(r) + typeof r.extra; });
say("P2 then [spread]", () => { const p = P2.resolve(1); const r = p.then(...[x => x]); return kind(r) + typeof r.extra; });
say("P2 then [call]", () => { const p = P2.resolve(1); const r = (f => f.call(p, x => x))(p.then); return kind(r) + typeof r.extra; });
say("P2 then [busy]", () => { const p = P2.resolve(1); const r = p.then(busy(x => x)); return kind(r) + typeof r.extra; });
say("P2 catch [direct]", () => { const p = P2.resolve(1); const r = p.catch(x => x); return kind(r) + typeof r.extra; });
say("P2 catch [key]", () => { const p = P2.resolve(1); const r = p["catch"](x => x); return kind(r) + typeof r.extra; });
say("P2 catch [optional]", () => { const p = P2.resolve(1); const r = p.catch?.(x => x); return kind(r) + typeof r.extra; });
say("P2 catch [spread]", () => { const p = P2.resolve(1); const r = p.catch(...[x => x]); return kind(r) + typeof r.extra; });
say("P2 catch [call]", () => { const p = P2.resolve(1); const r = (f => f.call(p, x => x))(p.catch); return kind(r) + typeof r.extra; });
say("P2 catch [busy]", () => { const p = P2.resolve(1); const r = p.catch(busy(x => x)); return kind(r) + typeof r.extra; });
say("P2 finally [direct]", () => { const p = P2.resolve(1); const r = p.finally(() => {}); return kind(r) + typeof r.extra; });
say("P2 finally [key]", () => { const p = P2.resolve(1); const r = p["finally"](() => {}); return kind(r) + typeof r.extra; });
say("P2 finally [optional]", () => { const p = P2.resolve(1); const r = p.finally?.(() => {}); return kind(r) + typeof r.extra; });
say("P2 finally [spread]", () => { const p = P2.resolve(1); const r = p.finally(...[() => {}]); return kind(r) + typeof r.extra; });
say("P2 finally [call]", () => { const p = P2.resolve(1); const r = (f => f.call(p, () => {}))(p.finally); return kind(r) + typeof r.extra; });
say("P2 finally [busy]", () => { const p = P2.resolve(1); const r = p.finally(busy(() => {})); return kind(r) + typeof r.extra; });
say("a promise whose constructor is replaced, then [direct]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = p.then(x => x); return kind(r); });
say("a promise whose constructor is replaced, then [key]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = p["then"](x => x); return kind(r); });
say("a promise whose constructor is replaced, then [optional]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = p.then?.(x => x); return kind(r); });
say("a promise whose constructor is replaced, then [spread]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = p.then(...[x => x]); return kind(r); });
say("a promise whose constructor is replaced, then [call]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = (f => f.call(p, x => x))(p.then); return kind(r); });
say("a promise whose constructor is replaced, then [busy]", () => { const p = Promise.resolve(1); p.constructor = P2; const r = p.then(busy(x => x)); return kind(r); });
say("a promise with an own then, catch [direct]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = p.catch(x => x); return String(r); });
say("a promise with an own then, catch [key]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = p["catch"](x => x); return String(r); });
say("a promise with an own then, catch [optional]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = p.catch?.(x => x); return String(r); });
say("a promise with an own then, catch [spread]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = p.catch(...[x => x]); return String(r); });
say("a promise with an own then, catch [call]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = (f => f.call(p, x => x))(p.catch); return String(r); });
say("a promise with an own then, catch [busy]", () => { const p = Promise.resolve(1); p.then = () => "own then"; const r = p.catch(busy(x => x)); return String(r); });
say("R2 test calls exec [direct]", () => { R2.calls = 0; const re = new R2("a"); const r = re.test("cat"); return r + " calls " + R2.calls; });
say("R2 test calls exec [key]", () => { R2.calls = 0; const re = new R2("a"); const r = re["test"]("cat"); return r + " calls " + R2.calls; });
say("R2 test calls exec [optional]", () => { R2.calls = 0; const re = new R2("a"); const r = re.test?.("cat"); return r + " calls " + R2.calls; });
say("R2 test calls exec [spread]", () => { R2.calls = 0; const re = new R2("a"); const r = re.test(...["cat"]); return r + " calls " + R2.calls; });
say("R2 test calls exec [call]", () => { R2.calls = 0; const re = new R2("a"); const r = (f => f.call(re, "cat"))(re.test); return r + " calls " + R2.calls; });
say("R2 test calls exec [busy]", () => { R2.calls = 0; const re = new R2("a"); const r = re.test(busy("cat")); return r + " calls " + R2.calls; });
say("an own exec, test [direct]", () => { const re = /a/; re.exec = () => null; const r = re.test("cat"); return r; });
say("an own exec, test [key]", () => { const re = /a/; re.exec = () => null; const r = re["test"]("cat"); return r; });
say("an own exec, test [optional]", () => { const re = /a/; re.exec = () => null; const r = re.test?.("cat"); return r; });
say("an own exec, test [spread]", () => { const re = /a/; re.exec = () => null; const r = re.test(...["cat"]); return r; });
say("an own exec, test [call]", () => { const re = /a/; re.exec = () => null; const r = (f => f.call(re, "cat"))(re.test); return r; });
say("an own exec, test [busy]", () => { const re = /a/; re.exec = () => null; const r = re.test(busy("cat")); return r; });
say("an own exec that is no function, test [direct]", () => { const re = /a/; re.exec = 5; const r = re.test("cat"); return r; });
say("an own exec that is no function, test [key]", () => { const re = /a/; re.exec = 5; const r = re["test"]("cat"); return r; });
say("an own exec that is no function, test [optional]", () => { const re = /a/; re.exec = 5; const r = re.test?.("cat"); return r; });
say("an own exec that is no function, test [spread]", () => { const re = /a/; re.exec = 5; const r = re.test(...["cat"]); return r; });
say("an own exec that is no function, test [call]", () => { const re = /a/; re.exec = 5; const r = (f => f.call(re, "cat"))(re.test); return r; });
say("an own exec that is no function, test [busy]", () => { const re = /a/; re.exec = 5; const r = re.test(busy("cat")); return r; });
say("lastIndex of a sticky one, exec [direct]", () => { const re = /a/y; re.lastIndex = 1; const r = re.exec("cat"); return S(r) + re.lastIndex; });
say("lastIndex of a sticky one, exec [key]", () => { const re = /a/y; re.lastIndex = 1; const r = re["exec"]("cat"); return S(r) + re.lastIndex; });
say("lastIndex of a sticky one, exec [optional]", () => { const re = /a/y; re.lastIndex = 1; const r = re.exec?.("cat"); return S(r) + re.lastIndex; });
say("lastIndex of a sticky one, exec [spread]", () => { const re = /a/y; re.lastIndex = 1; const r = re.exec(...["cat"]); return S(r) + re.lastIndex; });
say("lastIndex of a sticky one, exec [call]", () => { const re = /a/y; re.lastIndex = 1; const r = (f => f.call(re, "cat"))(re.exec); return S(r) + re.lastIndex; });
say("lastIndex of a sticky one, exec [busy]", () => { const re = /a/y; re.lastIndex = 1; const r = re.exec(busy("cat")); return S(r) + re.lastIndex; });
say("string.replace with R2 (its exec counts) [direct]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.replace(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R2 (its exec counts) [key]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s["replace"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R2 (its exec counts) [optional]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.replace?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R2 (its exec counts) [spread]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.replace(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replace with R2 (its exec counts) [call]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = (f => f.call(s, re, "X"))(s.replace); return S(r) + " calls " + R2.calls; });
say("string.replace with R2 (its exec counts) [busy]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.replace(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [direct]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.replace(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [key]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s["replace"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [optional]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.replace?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [spread]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.replace(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [call]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = (f => f.call(s, re, "X"))(s.replace); return S(r) + " calls " + R2.calls; });
say("string.replace with R3 (its own symbols) [busy]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.replace(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.replace(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s["replace"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.replace?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.replace(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = (f => f.call(s, re, "X"))(s.replace); return S(r) + " calls " + R2.calls; });
say("string.replace with an own exec [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.replace(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replace(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = s["replace"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replace?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replace(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = (f => f.call(s, re, "X"))(s.replace); return S(r) + " calls " + R2.calls; });
say("string.replace with an own @@replace [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replace(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [direct]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = s.replaceAll(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [key]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = s["replaceAll"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [optional]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = s.replaceAll?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [spread]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = s.replaceAll(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [call]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = (f => f.call(s, re, "X"))(s.replaceAll); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R2 (its exec counts) [busy]", () => { R2.calls = 0; const s = "cat", re = new R2("a", "g"); const r = s.replaceAll(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [direct]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = s.replaceAll(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [key]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = s["replaceAll"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [optional]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = s.replaceAll?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [spread]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = s.replaceAll(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [call]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = (f => f.call(s, re, "X"))(s.replaceAll); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with R3 (its own symbols) [busy]", () => { R2.calls = 0; const s = "cat", re = new R3("a", "g"); const r = s.replaceAll(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = s.replaceAll(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = s["replaceAll"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = s.replaceAll?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = s.replaceAll(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = (f => f.call(s, re, "X"))(s.replaceAll); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own exec [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { exec() { return null; } }); const r = s.replaceAll(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replaceAll(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = s["replaceAll"](re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replaceAll?.(re, "X"); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replaceAll(...[re, "X"]); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = (f => f.call(s, re, "X"))(s.replaceAll); return S(r) + " calls " + R2.calls; });
say("string.replaceAll with an own @@replace [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/g, { [Symbol.replace]() { return "own symbol"; } }); const r = s.replaceAll(busy(re), "X"); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [direct]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.match(re); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [key]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s["match"](re); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [optional]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.match?.(re); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [spread]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.match(...[re]); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [call]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = (f => f.call(s, re))(s.match); return S(r) + " calls " + R2.calls; });
say("string.match with R2 (its exec counts) [busy]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.match(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [direct]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.match(re); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [key]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s["match"](re); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [optional]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.match?.(re); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [spread]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.match(...[re]); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [call]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = (f => f.call(s, re))(s.match); return S(r) + " calls " + R2.calls; });
say("string.match with R3 (its own symbols) [busy]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.match(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.match(re); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s["match"](re); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.match?.(re); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.match(...[re]); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = (f => f.call(s, re))(s.match); return S(r) + " calls " + R2.calls; });
say("string.match with an own exec [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.match(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = s.match(re); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = s["match"](re); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = s.match?.(re); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = s.match(...[re]); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = (f => f.call(s, re))(s.match); return S(r) + " calls " + R2.calls; });
say("string.match with an own @@match [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.match]() { return "own symbol"; } }); const r = s.match(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [direct]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.search(re); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [key]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s["search"](re); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [optional]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.search?.(re); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [spread]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.search(...[re]); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [call]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = (f => f.call(s, re))(s.search); return S(r) + " calls " + R2.calls; });
say("string.search with R2 (its exec counts) [busy]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.search(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [direct]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.search(re); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [key]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s["search"](re); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [optional]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.search?.(re); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [spread]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.search(...[re]); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [call]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = (f => f.call(s, re))(s.search); return S(r) + " calls " + R2.calls; });
say("string.search with R3 (its own symbols) [busy]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.search(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.search(re); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s["search"](re); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.search?.(re); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.search(...[re]); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = (f => f.call(s, re))(s.search); return S(r) + " calls " + R2.calls; });
say("string.search with an own exec [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.search(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = s.search(re); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = s["search"](re); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = s.search?.(re); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = s.search(...[re]); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = (f => f.call(s, re))(s.search); return S(r) + " calls " + R2.calls; });
say("string.search with an own @@search [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.search]() { return "own symbol"; } }); const r = s.search(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [direct]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.split(re); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [key]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s["split"](re); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [optional]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.split?.(re); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [spread]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.split(...[re]); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [call]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = (f => f.call(s, re))(s.split); return S(r) + " calls " + R2.calls; });
say("string.split with R2 (its exec counts) [busy]", () => { R2.calls = 0; const s = "cat", re = new R2("a", ""); const r = s.split(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [direct]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.split(re); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [key]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s["split"](re); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [optional]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.split?.(re); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [spread]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.split(...[re]); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [call]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = (f => f.call(s, re))(s.split); return S(r) + " calls " + R2.calls; });
say("string.split with R3 (its own symbols) [busy]", () => { R2.calls = 0; const s = "cat", re = new R3("a", ""); const r = s.split(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.split(re); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s["split"](re); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.split?.(re); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.split(...[re]); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = (f => f.call(s, re))(s.split); return S(r) + " calls " + R2.calls; });
say("string.split with an own exec [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { exec() { return null; } }); const r = s.split(busy(re)); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [direct]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = s.split(re); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [key]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = s["split"](re); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [optional]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = s.split?.(re); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [spread]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = s.split(...[re]); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [call]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = (f => f.call(s, re))(s.split); return S(r) + " calls " + R2.calls; });
say("string.split with an own @@split [busy]", () => { R2.calls = 0; const s = "cat", re = Object.assign(/a/, { [Symbol.split]() { return "own symbol"; } }); const r = s.split(busy(re)); return S(r) + " calls " + R2.calls; });
say("replace with an object that has @@replace [direct]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = s.replace(o, "X"); return r; });
say("replace with an object that has @@replace [key]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = s["replace"](o, "X"); return r; });
say("replace with an object that has @@replace [optional]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = s.replace?.(o, "X"); return r; });
say("replace with an object that has @@replace [spread]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = s.replace(...[o, "X"]); return r; });
say("replace with an object that has @@replace [call]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = (f => f.call(s, o, "X"))(s.replace); return r; });
say("replace with an object that has @@replace [busy]", () => { const s = "cat", o = { [Symbol.replace]() { return "object's"; } }; const r = s.replace(busy(o), "X"); return r; });
say("split with an object that has @@split [direct]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = s.split(o); return r; });
say("split with an object that has @@split [key]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = s["split"](o); return r; });
say("split with an object that has @@split [optional]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = s.split?.(o); return r; });
say("split with an object that has @@split [spread]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = s.split(...[o]); return r; });
say("split with an object that has @@split [call]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = (f => f.call(s, o))(s.split); return r; });
say("split with an object that has @@split [busy]", () => { const s = "cat", o = { [Symbol.split]() { return "object's"; } }; const r = s.split(busy(o)); return r; });
say("an heir of Map has [direct]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.has(1); return r; });
say("an heir of Map has [key]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o["has"](1); return r; });
say("an heir of Map has [optional]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.has?.(1); return r; });
say("an heir of Map has [spread]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.has(...[1]); return r; });
say("an heir of Map has [call]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = (f => f.call(o, 1))(o.has); return r; });
say("an heir of Map has [busy]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.has(busy(1)); return r; });
say("an heir of Map, its own get get [direct]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.get(1); return r; });
say("an heir of Map, its own get get [key]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o["get"](1); return r; });
say("an heir of Map, its own get get [optional]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.get?.(1); return r; });
say("an heir of Map, its own get get [spread]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.get(...[1]); return r; });
say("an heir of Map, its own get get [call]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = (f => f.call(o, 1))(o.get); return r; });
say("an heir of Map, its own get get [busy]", () => { const o = new (class extends Map { get(k) { return "heir's get"; } })([[1, 2]]); const r = o.get(busy(1)); return r; });
say("an heir of Set add [direct]", () => { const o = new (class extends Set {})([1]); const r = o.add(2); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Set add [key]", () => { const o = new (class extends Set {})([1]); const r = o["add"](2); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Set add [optional]", () => { const o = new (class extends Set {})([1]); const r = o.add?.(2); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Set add [spread]", () => { const o = new (class extends Set {})([1]); const r = o.add(...[2]); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Set add [call]", () => { const o = new (class extends Set {})([1]); const r = (f => f.call(o, 2))(o.add); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Set add [busy]", () => { const o = new (class extends Set {})([1]); const r = o.add(busy(2)); return r.constructor === Set ? "a Set" : "the heir " + r.size; });
say("an heir of Date getTime [direct]", () => { const o = new (class extends Date { valueOf() { return 7; } })(0); const r = o.getTime(); return r; });
say("an heir of Date getTime [key]", () => { const o = new (class extends Date { valueOf() { return 7; } })(0); const r = o["getTime"](); return r; });
say("an heir of Date getTime [optional]", () => { const o = new (class extends Date { valueOf() { return 7; } })(0); const r = o.getTime?.(); return r; });
say("an heir of Date getTime [spread]", () => { const o = new (class extends Date { valueOf() { return 7; } })(0); const r = o.getTime(...[]); return r; });
say("an heir of Date getTime [call]", () => { const o = new (class extends Date { valueOf() { return 7; } })(0); const r = (f => f.call(o))(o.getTime); return r; });
say("a Map with an own has has [direct]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = o.has(1); return r; });
say("a Map with an own has has [key]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = o["has"](1); return r; });
say("a Map with an own has has [optional]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = o.has?.(1); return r; });
say("a Map with an own has has [spread]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = o.has(...[1]); return r; });
say("a Map with an own has has [call]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = (f => f.call(o, 1))(o.has); return r; });
say("a Map with an own has has [busy]", () => { const o = Object.assign(new Map([[1, 2]]), { has() { return "own has"; } }); const r = o.has(busy(1)); return r; });

// GENERATED: S H join P2
// CHECK-LABEL: function {{*}}name="S"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="unprintable"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="H"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="join"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="H's join"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="P2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="P2"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="P2"
// CHECK-NEXT: v13 = PropGet v12 key="made"
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b6(v15)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: PropSet v10, v20 key="made"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = TypeTest v22 testedType=object
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: Jump -> next b12(v24)
// CHECK-NEXT: b8(v25):
// CHECK-NEXT: v26 = TypeTest v25 testedType=undefined
// CHECK-NEXT: Branch v26 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: v28 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v28 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b11(v31):
// CHECK-NEXT: Jump -> next b12(v31)
// CHECK-NEXT: b12(v32):
// CHECK-NEXT: Return v32
// CHECK-NEXT: b13(v33) frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=DerivedConstructorResult name="P2"
// CHECK-NEXT: Throw v34
// CHECK-NEXT: b14(v35) frequency=Unlikely:
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v36
// CHECK-NEXT: }
