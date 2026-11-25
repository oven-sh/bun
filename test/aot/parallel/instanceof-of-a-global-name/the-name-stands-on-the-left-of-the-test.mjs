globalThis.Crate = function Crate() {};
function isA(Kind) { return Crate instanceof Kind; }
function isNoneOf(Kind) { try { return Nowhere instanceof Kind; } catch (error) { return error.constructor.name; } }
globalThis.kept = [isA, isNoneOf];
for (const test of globalThis.kept) console.log(test(Function), test(Object), test(Crate), test(Array));
globalThis.Crate = [];
for (const test of globalThis.kept) console.log(test(Function), test(Object), test(Array));
