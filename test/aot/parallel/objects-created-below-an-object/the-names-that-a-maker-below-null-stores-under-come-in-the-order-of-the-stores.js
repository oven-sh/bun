"use strict";
const attempt = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const hide = (v) => [v][JSON.parse("0")];
const show = (o) => [Object.keys(o).join(), JSON.stringify(o), Object.entries(o).join(";"), (() => { const seen = []; for (const k in o) seen.push(k); return seen.join(); })(), Reflect.ownKeys(o).map(String).join(), Object.keys({ ...o }).join()].join(" | ");

const backwards = Object.create(null);
backwards.zeta = 1; backwards.mid = 2; backwards.alpha = 3;
console.log("backwards", show(backwards));

const branch = Object.create(null);
branch.first = 1;
if (hide(false)) branch.never = 2;
if (hide(true)) branch.taken = 3;
branch.last = 4;
console.log("branch", show(branch), "never" in branch, branch.never, Object.hasOwn(branch, "never"), "taken" in branch);

const again = Object.create(null);
again.a = 1; again.b = 2; again.c = 3;
delete again.a;
again.a = 4;
console.log("again", show(again));
delete again.b; delete again.c; delete again.a;
console.log("emptied", show(again), again.a, "a" in again);
again.c = 5; again.a = 6;
console.log("refilled", show(again));

const odd = Object.create(null);
odd.__proto__ = 5; odd.constructor = 6; odd.toString = 7; odd.valueOf = 8; odd.hasOwnProperty = 9; odd.length = 10; odd.name = 11; odd.prototype = 12;
console.log("odd", show(odd), odd.__proto__, Object.getPrototypeOf(odd) === null, attempt(() => "" + odd), attempt(() => odd + 1));

const later = Object.create(null);
later.seen = 1;
function fillLater(v) { later.byFunction = v; later.seen += v; return later.byFunction; }
console.log("later before", show(later), later.byFunction);
console.log("later", fillLater(2), show(later));

const compound = Object.create(null);
compound.n += 1; compound.s ||= "set"; compound.q ??= "asked"; compound.n = 2; compound.n++;
console.log("compound", show(compound));

const mixed = Object.create(null);
mixed.b = 1; mixed[2] = "two"; mixed.a = 2; mixed[hide("k")] = 3; mixed[1] = "one"; mixed[Symbol.for("s")] = 4; mixed.c = 5;
console.log("mixed", show(mixed));

const described = Object.create(null);
described.plain = 1; described.hidden = 2; described.got = 3;
Object.defineProperty(described, "hidden", { enumerable: false });
Object.defineProperty(described, "got", { get() { return "by a getter"; }, enumerable: true, configurable: true });
console.log("described", show(described), described.hidden, described.got, attempt(() => { described.got = 1; }));

const frozen = Object.create(null);
frozen.a = 1; frozen.b = 2;
Object.freeze(frozen);
console.log("frozen", show(frozen), attempt(() => { frozen.a = 3; }), attempt(() => { frozen.c = 3; }), attempt(() => delete frozen.a), Object.isFrozen(frozen));

const twice = Object.create(null);
twice.x = 1; twice.x = 2; twice.y = twice.x + 1; twice.x = twice.y + 1;
console.log("twice", show(twice));

const wide = Object.create(null);
wide.p00 = 0; wide.p01 = 1; wide.p02 = 2; wide.p03 = 3; wide.p04 = 4; wide.p05 = 5; wide.p06 = 6; wide.p07 = 7; wide.p08 = 8; wide.p09 = 9;
wide.p10 = 10; wide.p11 = 11; wide.p12 = 12; wide.p13 = 13; wide.p14 = 14; wide.p15 = 15; wide.p16 = 16; wide.p17 = 17; wide.p18 = 18; wide.p19 = 19;
wide.p20 = 20; wide.p21 = 21; wide.p22 = 22; wide.p23 = 23; wide.p24 = 24; wide.p25 = 25; wide.p26 = 26; wide.p27 = 27; wide.p28 = 28; wide.p29 = 29;
wide.p30 = 30; wide.p31 = 31; wide.p32 = 32; wide.p33 = 33; wide.p34 = 34; wide.p35 = 35; wide.p36 = 36; wide.p37 = 37; wide.p38 = 38; wide.p39 = 39;
console.log("wide", Object.keys(wide).length, Object.keys(wide).slice(-3).join(), wide.p00 + wide.p19 + wide.p39, JSON.stringify(wide).length);

const thrown = Object.create(null);
console.log("thrown", attempt(() => { thrown.a = 1; thrown.b = hide(null).x; thrown.c = 3; }), show(thrown));

const handed = Object.create(null);
handed.a = 1;
hide(handed).fromOutside = 2;
handed.b = 3;
console.log("handed", show(handed), handed.fromOutside);

function inFunction(i) { const r = Object.create(null); r.second = i; if (i & 1) r.odd = true; r.first = i * 2; return r; }
console.log("in a function", show(inFunction(1)), show(inFunction(2)));
const made = [];
for (let i = 0; i < 3; i++) { const r = Object.create(null); r.z = i; r.a = i + 1; made.push(r); }
console.log("in a loop", made.map(show).join(" / "));
