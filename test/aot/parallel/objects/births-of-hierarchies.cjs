// Instances of classes with heirs, constructed through functions that know none of them, in every order of their fields.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
let leaked = null;
class Base { constructor(i) { this.a = i; this.b = i + 1; this.c = "x"; } sum() { return this.a + this.b; } }
class Heir extends Base { constructor(i) { super(i); this.d = null; } }
class Some { constructor(i) { if (i & 1) this.first = i; this.a = i; if (i & 2) this.b = i + 1; this.c = "y"; } }
class OfSome extends Some { constructor(i) { super(i); this.b = 5; if (i & 4) delete this.a; this.e = i; } }
class Private { #p = 0; #q; constructor(i) { this.a = i; if (i & 1) this.#q = i; this.b = 2; } get q() { return this.#q; } set q(v) { this.#q = v; } has(o) { return #q in o; } }
class OfPrivate extends Private { #r = "r"; own = 1; constructor(i) { super(i); this.c = i; } get r() { return this.#r; } }
class Leaks { constructor(i) { this.a = i; if (i % 3 === 0) leaked = this; if (i % 9 === 0) throw new RangeError("left"); this.b = i; this.c = i; } }
class OfLeaks extends Leaks { constructor(i) { super(i); this.d = 4; } }
class Fields { a = 1; b; c = this.a + 1; constructor(i) { this.a = i; } }
class OfFields extends Fields { d = this.c; a = "own"; constructor(i) { super(i); this.e = i; } }
class Frozen { constructor(i) { this.a = i; if (i % 5 === 0) Object.freeze(this); else this.b = i; } }
class OfFrozen extends Frozen { constructor(i) { super(i); if (Object.isExtensible(this)) this.c = 1; } }
class Numbers { constructor(i) { this.x = i / 2; this.y = i | 0; this.z = i % 2 === 0; } }
class OfNumbers extends Numbers { constructor(i) { super(i); this.w = i % 4 ? i : "text"; } }
const classes = [Base, Heir, Some, OfSome, Private, OfPrivate, Leaks, OfLeaks, Fields, OfFields, Frozen, OfFrozen, Numbers, OfNumbers];
const makers = classes.map((C, place) => place % 3 === 0 ? i => new C(i) : place % 3 === 1 ? i => Reflect.construct(C, [i]) : (i => { const K = classes[place]; return new K(i); }));
const read = o => [o.a, o.b, o.c, o.d, o.e, o.x, o.y, o.z, o.w, o.first, o.q, o.r, o.own].map(v => v === undefined ? "-" : String(v)).join();
const typed = o => o instanceof Base ? o.sum() : o instanceof Numbers ? o.x + o.y : o instanceof Some ? (o.b ?? 0) + (o.a ?? 0) : o instanceof Leaks ? o.a + (o.b ?? -1) : o.a;
const expected = (place, i) => {
    switch (place) {
    case 0: return `${i},${i + 1},x,-,-,-,-,-,-,-,-,-,-`;
    case 1: return `${i},${i + 1},x,null,-,-,-,-,-,-,-,-,-`;
    case 2: return `${i},${i & 2 ? i + 1 : "-"},y,-,-,-,-,-,-,${i & 1 ? i : "-"},-,-,-`;
    case 3: return `${i & 4 ? "-" : i},5,y,-,${i},-,-,-,-,${i & 1 ? i : "-"},-,-,-`;
    case 4: return `${i},2,-,-,-,-,-,-,-,-,${i & 1 ? i : "-"},-,-`;
    case 5: return `${i},2,${i},-,-,-,-,-,-,-,${i & 1 ? i : "-"},r,1`;
    case 6: return `${i},${i},${i},-,-,-,-,-,-,-,-,-,-`;
    case 7: return `${i},${i},${i},4,-,-,-,-,-,-,-,-,-`;
    case 8: return `${i},-,2,-,-,-,-,-,-,-,-,-,-`;
    case 9: return `own,-,2,2,${i},-,-,-,-,-,-,-,-`;
    case 10: return `${i},${i % 5 ? i : "-"},-,-,-,-,-,-,-,-,-,-,-`;
    case 11: return `${i},${i % 5 ? i : "-"},${i % 5 ? 1 : "-"},-,-,-,-,-,-,-,-,-,-`;
    case 12: return `-,-,-,-,-,${i / 2},${i},${i % 2 === 0},-,-,-,-,-`;
    case 13: return `-,-,-,-,-,${i / 2},${i},${i % 2 === 0},${i % 4 ? i : "text"},-,-,-,-`;
    }
};
let total = 0;
for (let round = 0; round < 3; ++round)
    for (let i = 0; i < 400; ++i)
        for (let place = 0; place < classes.length; ++place) {
            let made;
            try { made = makers[place](i); } catch (error) { check("thrown", error.constructor, RangeError); check("left unfinished", read(leaked), `${i},-,-,-,-,-,-,-,-,-,-,-,-`); check("typed unfinished", typed(leaked), i - 1); leaked.b = 7; check("stored later", typed(leaked), i + 7); continue; }
            if (made instanceof Leaks && i % 9 === 0) check("not thrown", 1, 0);
            check(classes[place].name + i, read(made), expected(place, i));
            check("class of " + classes[place].name, made.constructor, classes[place]);
            total += Number(typed(made)) || 0;
            if (i % 50 === 7) { if (!Object.isFrozen(made)) { delete made.b; check("deleted", made.b, undefined); made.b = "again"; check("again", made.b, "again"); check("last key", Object.keys(made).at(-1), "b"); } }
            if (i === 399 && round === 1) { Object.defineProperty(made, "a", { get() { return "got"; }, configurable: true }); check("accessor", made.a, "got"); }
        }
if (globalThis.Bun) Bun.gc(true);
for (let i = 1; i < 60; ++i) for (let place = 0; place < classes.length; ++place) { if (i % 9 === 0 && classes[place].prototype instanceof Leaks || classes[place] === Leaks && i % 9 === 0) continue; check("behind a collection", read(makers[place](i)), expected(place, i)); }
console.log("ended", failures, total);
