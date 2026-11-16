globalThis.Crate = function Crate() {};
function both(x) { const Kind = Crate; return [typeof Kind, Kind.name, x instanceof Kind]; }
function twice(x) { const Kind = Crate; return [x instanceof Kind, Kind instanceof Kind, Kind instanceof Function]; }
function left() { return [Crate instanceof Function, Crate instanceof Object, Crate instanceof Crate]; }
globalThis.kept = [both, twice, left];
for (const test of globalThis.kept) console.log(test(new Crate()).join(), test({}).join());
