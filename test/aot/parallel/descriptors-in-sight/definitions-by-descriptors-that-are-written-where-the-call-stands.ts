// `Object.defineProperty(o, "name", { .. })` with the descriptor written at the call changes that one name of that one object. Everything that a half of an accessor, a value or a flag can do afterwards must still be seen.
const unseen: (text: string) => any = (0, eval);
const leak: (x: any) => void = unseen("(x) => { globalThis.leaked = x; }");
const spoil: (x: any) => void = unseen("(x) => { x.next = () => 'spoiled'; x.count = 'spoiled'; }");
const never = process.argv.length > 50;
const always = process.argv.length < 50;
function attempt(what: string, run: () => unknown) {
    try {
        console.log(what, String(run()));
    } catch (error) {
        console.log(what, "threw", (error as Error).constructor.name, (error as Error).message);
    }
}

// ---- A maker whose closures stay known
function make(start: number, define: number) {
    let pos = start;
    const o: any = { next: () => pos++, peek: () => pos, count: 0 };
    if (define === 1) Object.defineProperty(o, "shown", { get: () => pos });
    if (define === 2) Object.defineProperty(o, "shown", { get() { spoil(this); return pos; } });
    if (define === 3) Object.defineProperty(o, "shown", { set(v: number) { spoil(this); pos = v; } });
    if (define === 4) Object.defineProperty(o, "shown", { value() { spoil(this); return "ran"; } });
    if (define === 5) Object.defineProperty(o, "shown", { get() { leak(this); return 5; }, set(v) { pos = v; }, enumerable: true, configurable: true });
    if (never) Object.defineProperty(o, "hidden", { get() { spoil(this); return 1; } });
    return o;
}
for (let define = 0; define <= 5; define++) {
    const s = make(10, define);
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += s.next() + s.peek();
    attempt("maker " + define + " in front", () => sum + " " + s.count + " " + Object.keys(s).join());
    attempt("maker " + define + " read", () => typeof s.shown === "function" ? s.shown() : s.shown);
    attempt("maker " + define + " behind the read", () => s.next() + " " + s.count);
    attempt("maker " + define + " store", () => { s.shown = 100; return s.peek(); });
    attempt("maker " + define + " behind the store", () => s.next() + " " + s.count);
    attempt("maker " + define + " hidden", () => s.hidden);
}
attempt("what leaked is the object", () => { const s = make(1, 5); s.shown; (globalThis as any).leaked.count = 77; return s.count; });

// ---- A half reached in other ways than by the name
{
    const s = make(3, 2);
    const key = always ? "shown" : "next";
    attempt("by a computed key", () => s[key] + " " + s.next());
    const t = make(3, 5);
    attempt("by a listing", () => JSON.stringify(t) + " " + Object.values(t).length + " " + ((globalThis as any).leaked === t));
    const u = make(3, 2);
    attempt("by its description", () => { const other = { next: () => "other", count: 1 }; Object.getOwnPropertyDescriptor(u, "shown")!.get!.call(other); return other.next() + " " + u.next(); });
    const v = make(3, 2);
    attempt("through an object below", () => { const below = Object.create(v); below.shown; return Object.keys(below).join() + " " + below.next() + " " + v.next(); });
    const w = make(3, 5);
    attempt("by a spread", () => { const copy = { ...w }; return copy.shown + " " + ((globalThis as any).leaked === w); });
}

// ---- A field that has a slot is defined again
class Point {
    x: number; y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    sum() { return this.x + this.y; }
}
function sumOf(p: Point) { let total = 0; for (let i = 0; i < 10; i++) total += p.x + p.y; return total; }
{
    const a = new Point(1, 2);
    attempt("point in front", () => sumOf(a) + " " + a.sum());
    let reads = 0;
    Object.defineProperty(a, "x", { get() { reads++; return 100; }, configurable: true });
    attempt("x is a getter", () => sumOf(a) + " " + a.sum() + " " + reads);
    attempt("a store into a getter alone", () => { "use strict"; a.x = 5; return a.x; });
    Object.defineProperty(a, "x", { value: 7, writable: false, enumerable: false, configurable: true });
    attempt("x is read only and hidden", () => sumOf(a) + " " + Object.keys(a).join());
    attempt("a store into what is read only", () => { a.x = 5; return a.x; });
    Object.defineProperty(a, "x", { value: 8, writable: true, enumerable: true, configurable: true });
    attempt("x is plain again", () => { a.x = 9; return sumOf(a) + " " + Object.keys(a).join(); });
    const b = new Point(3, 4);
    attempt("another point knows nothing of it", () => sumOf(b) + " " + Object.keys(b).join());
    Object.defineProperty(b, "y", { value: "text" });
    attempt("a value of another type", () => sumOf(b) + " " + b.sum());
    Object.defineProperty(b, "sum", { value() { return "own sum"; } });
    attempt("a method hidden by an own value", () => b.sum() + " " + new Point(1, 1).sum());
    const c = new Point(5, 6);
    Object.defineProperty(c, "z", { value: 1, enumerable: true });
    attempt("a name more", () => Object.keys(c).join() + " " + JSON.stringify(c) + " " + sumOf(c));
    attempt("it is read only", () => { (c as any).z = 2; return (c as any).z; });
}

// ---- The flags, each way
for (const enumerable of [false, true]) for (const writable of [false, true]) for (const configurable of [false, true]) {
    const o: any = { a: 1 };
    Object.defineProperty(o, "b", { value: 2, enumerable: enumerable, writable: writable, configurable: configurable });
    attempt("flags " + enumerable + " " + writable + " " + configurable, () => {
        let stored = "stored"; try { o.b = 3; } catch { stored = "refused"; }
        let deleted = "deleted"; try { delete o.b; } catch { deleted = "kept"; }
        return Object.keys(o).join() + " " + o.b + " " + stored + " " + deleted;
    });
}

// ---- Targets that refuse
attempt("a frozen target", () => { const o = Object.freeze({ a: 1 }); Object.defineProperty(o, "b", { value: 1 }); return "defined"; });
attempt("a sealed target", () => { const o = Object.seal({ a: 1 }); Object.defineProperty(o, "a", { value: 2 }); return o.a; });
attempt("Reflect on a frozen target", () => Reflect.defineProperty(Object.freeze({ a: 1 }), "b", { value: 1 }));
attempt("Reflect", () => { const o: any = { a: 1 }; return Reflect.defineProperty(o, "b", { get() { return this.a + 1; } }) + " " + o.b; });
attempt("a primitive target", () => Object.defineProperty(1 as any, "b", { value: 1 }));
attempt("a value and a getter", () => Object.defineProperty({}, "b", { value: 1, get() { return 1; } } as any));
attempt("a getter that is no function", () => Object.defineProperty({}, "b", { get: 1 } as any));

// ---- Descriptors that are NOT in sight
function defineWith(o: any, descriptor: PropertyDescriptor) { Object.defineProperty(o, "shown", descriptor); return o; }
attempt("a descriptor that arrives as a parameter", () => { const s = defineWith(make(1, 0), { get() { spoil(this); return 1; } }); s.shown; return s.next(); });
attempt("a descriptor from unseen code", () => { const s = defineWith(make(1, 0), unseen("({ get() { this.next = () => 'from outside'; return 1; } })")); s.shown; return s.next(); });
attempt("a descriptor that has been handed out", () => { const d: PropertyDescriptor = { value: 1 }; unseen("(d) => { delete d.value; d.get = function () { this.next = () => 'swapped'; return 2; }; }")(d); const s = make(1, 0); Object.defineProperty(s, "shown", d); s.shown; return s.next(); });
attempt("a descriptor that is stored into behind its literal", () => { const d: PropertyDescriptor = { enumerable: true }; d.get = function (this: any) { spoil(this); return 3; }; const s = make(1, 0); Object.defineProperty(s, "shown", d); s.shown; return s.next(); });
attempt("a descriptor used in every turn", () => { const d: PropertyDescriptor = { get() { spoil(this); return 4; }, configurable: true }; let last: any; for (let i = 0; i < 3; i++) { last = make(i, 0); Object.defineProperty(last, "shown", d); } last.shown; return last.next(); });
attempt("a key that is computed", () => { const s = make(1, 0); const key = always ? "next" : "peek"; Object.defineProperty(s, key, { value: () => "defined over" }); return s.next() + " " + s.peek(); });
attempt("a descriptor with a getter of its own", () => { const s = make(1, 0); Object.defineProperty(s, "shown", { get get() { return function (this: any) { spoil(this); return 6; }; } }); s.shown; return s.next(); });
attempt("a descriptor below another object", () => { const s = make(1, 0); const d = Object.create({ get(this: any) { spoil(this); return 7; } }); Object.defineProperty(s, "shown", d); s.shown; return s.next(); });

// What lies on Object.prototype under `get`, `set` or `value` would answer for a descriptor too. A compiled executable refuses the store ("built-in objects are read-only in a compiled executable"), so no program can lay it there.
