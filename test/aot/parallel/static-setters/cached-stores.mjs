const attempt = f => { try { return f(); } catch (e) { return e.name; } };
function make(n) { return class S { static #v = n; static log = []; static get v() { return this.#v; } static set v(x) { S.log.push(x); S.#v = x & 63; } static set only(x) { S.log.push(-x); } static get fixed() { return 5; } static plain = 1; }; }
const kinds = [make(1), make(2), make(3)];
class Heir extends kinds[0] { static set only(x) { super.only = x + 1; } static get v() { return super.v === undefined ? 0 : 1; } }
class Below extends kinds[1] { static extra = 2; }
function store(K, x) { K.only = x; K.plain = x; try { K.v = x; } catch (e) { return e.name; } return K.plain; }
let s = 0;
for (let i = 0; i < 300; i++) s = (s * 3 + store(kinds[i % 3], i)) | 0;
console.log("stores", s, kinds.map(K => K.log.length + "," + K.v + "," + K.plain).join(" "));
for (let i = 0; i < 30; i++) { attempt(() => { Heir.only = i; }); attempt(() => { Below.only = i; }); attempt(() => { Below.v = i; }); Heir.plain = i; Below.plain = i; Below.extra = i; }
console.log("heirs", kinds.map(K => K.log.length + "," + K.plain).join(" "), Object.keys(Heir).join(), Object.keys(Below).join(), attempt(() => Below.v));
function write(K, x) { "use strict"; K.level = x; return K.level; }
class L { static _n = 0; static get level() { return L._n; } static set level(x) { L._n = x; } }
class Plain { static level = 1; }
class None { }
class Fixed { static get level() { return 9; } }
let t = 0;
for (let i = 0; i < 300; i++) { const K = [L, Plain, None, Fixed][i & 3]; t += attempt(() => write(K, i)) === "TypeError" ? 1 : K.level; }
console.log("write", t, L._n, Plain.level, None.level, Object.keys(None).join());
for (let i = 0; i < 100; i++) write(L, i);
Object.defineProperty(L, "level", { value: 3, writable: true, configurable: true });
for (let i = 0; i < 100; i++) write(L, i + 500);
console.log("over", L.level, L._n, Object.getOwnPropertyDescriptor(L, "level").writable);
Object.defineProperty(L, "level", { get() { return this.k; }, set(x) { this.k = x * 2; }, configurable: true });
for (let i = 0; i < 100; i++) write(L, i);
console.log("again", L.level, L.k);
delete L.level;
for (let i = 0; i < 100; i++) write(L, i);
console.log("deleted", L.level, Object.keys(L).join());
class Frozen { static #n = 0; static get level() { return Frozen.#n; } static set level(x) { Frozen.#n = x; } }
Object.freeze(Frozen);
for (let i = 0; i < 100; i++) write(Frozen, i);
console.log("frozen", Frozen.level, attempt(() => { Frozen.other = 1; }));
class Proto { static get level() { return this.x ?? 0; } static set level(x) { this.x = x; } }
class Under extends Proto { }
for (let i = 0; i < 100; i++) { write(Under, i); write(Proto, i * 2); }
console.log("proto", Under.x, Proto.x, Object.keys(Under).join());
Object.setPrototypeOf(Under, class { static set level(x) { this.y = x; } static get level() { return this.y; } });
for (let i = 0; i < 100; i++) write(Under, i + 7);
console.log("moved", Under.x, Under.y);
Object.setPrototypeOf(Under, null);
for (let i = 0; i < 100; i++) write(Under, i + 70);
console.log("null", Under.level, Object.keys(Under).join());
class Throws { static get level() { return 1; } static set level(x) { if (x > 50) throw new RangeError("x"); Throws.seen = x; } }
let thrown = 0; for (let i = 0; i < 100; i++) thrown += attempt(() => write(Throws, i)) === "RangeError" ? 1 : 0;
console.log("throws", thrown, Throws.seen);
class Changing { static set level(x) { if (x === 50) Object.defineProperty(Changing, "level", { value: -1, writable: true, configurable: true }); Changing.last = x; } static get level() { return 0; } }
for (let i = 0; i < 100; i++) write(Changing, i);
console.log("changing", Changing.level, Changing.last);
