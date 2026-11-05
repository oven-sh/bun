// `{ ...source, name: value }` written where only a type parameter or a union is known. Whatever the source is, the result is what the language says: a new ordinary-looking object below Object.prototype
// with the source's own enumerable properties as plain data properties, in the source's order, then what the literal adds.
type Fields = { id: number; label: string };
type Wide = { id: number; label: string; extra: number[]; nested: { a: number }; maybe?: string; flag: boolean };
type Circle = { kind: "circle"; radius: number; id: number };
type Square = { kind: "square"; side: number; id: number; label: string };
type Shape = Circle | Square;

function touch<T>(source: T, more: Partial<T>): T {
    return { ...source, ...more };
}
function relabel<T extends Fields>(source: T, label: string): T {
    return { ...source, label };
}
function renumber(shape: Shape, id: number): Shape {
    return { ...shape, id };
}
function alone<T>(source: T): T {
    return { ...source };
}
function withKey<T, K extends keyof T>(source: T, key: K, value: T[K]): T {
    return { ...source, [key]: value };
}
function thenGetter<T extends Fields>(source: T): T & { readonly twice: number } {
    return { ...source, get twice() { return this.id * 2; } };
}

const lines: string[] = [];
const calls: string[] = [];
function describe(value: unknown): string {
    if (value === null || typeof value !== "object")
        return String(value);
    const object = value as Record<PropertyKey, unknown>;
    const parts = Reflect.ownKeys(object).map((key) => {
        const d = Object.getOwnPropertyDescriptor(object, key)!;
        const form = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + (d.get ? "g" : "") + (d.set ? "s" : "");
        return String(key) + ":" + form + ":" + (d.get ? "accessor" : JSON.stringify(d.value) ?? String(d.value));
    });
    const prototype = Object.getPrototypeOf(object);
    const below = prototype === Object.prototype ? "Object.prototype" : prototype === null ? "null" : prototype.constructor?.name ?? "other";
    return "{" + parts.join(" ") + "} below " + below + (Object.isFrozen(object) ? " frozen" : Object.isSealed(object) ? " sealed" : Object.isExtensible(object) ? "" : " closed");
}
function attempt(title: string, run: () => unknown) {
    // Often enough for whatever remembers to have remembered.
    const said: string[] = [];
    for (let round = 0; round < 12; round++) {
        calls.length = 0;
        let outcome: string;
        try {
            outcome = describe(run());
        } catch (error) {
            outcome = (error as Error).constructor.name;
        }
        if (calls.length)
            outcome += " [" + calls.join() + "]";
        if (said[said.length - 1] !== outcome)
            said.push(outcome);
    }
    lines.push(title + ": " + said.join(" > "));
}
const any = <T>(value: unknown) => value as T;
const wide = (): Wide => ({ id: 1, label: "w", extra: [1, 2], nested: { a: 3 }, flag: true });

attempt("a record", () => relabel(wide(), "x"));
attempt("a record, touched", () => touch(wide(), { flag: false, maybe: "m" }));
attempt("a record, alone", () => alone(wide()));
attempt("a record, by key", () => withKey(wide(), "extra", [9]));
attempt("a record, then a getter", () => thenGetter(wide()));
attempt("the copy is another object", () => { const source = wide(); const copy = alone(source); copy.id = 7; copy.nested.a = 8; return [source.id, copy.id, source.nested.a, source === copy].join(); });
attempt("a circle", () => renumber({ kind: "circle", radius: 2, id: 1 }, 5));
attempt("a square", () => renumber({ kind: "square", side: 2, id: 1, label: "s" }, 6));

// The source has more than its type says, less, or in another order.
attempt("keys in another order", () => relabel({ label: "first", id: 2 }, "x"));
attempt("an optional member stored late", () => { const source = wide(); source.maybe = "late"; return relabel(source, "x"); });
attempt("a name outside the type", () => { const source = wide(); any<Record<string, number>>(source).outside = 4; return relabel(source, "x"); });
attempt("a symbol and an index", () => { const source = wide(); any<Record<PropertyKey, number>>(source)[Symbol.for("s")] = 1; any<Record<PropertyKey, number>>(source)[3] = 2; return relabel(source, "x"); });
attempt("a member deleted", () => { const source = wide(); delete source.maybe; delete any<Partial<Wide>>(source).flag; return relabel(source, "x"); });
attempt("a member deleted and stored again", () => { const source = wide(); delete any<Partial<Wide>>(source).id; source.id = 9; return relabel(source, "x"); });
attempt("a value of another type", () => { const source = wide(); any<Record<string, unknown>>(source).id = "text"; return relabel(source, "x"); });
attempt("undefined and null in members", () => { const source = wide(); any<Record<string, unknown>>(source).id = undefined; any<Record<string, unknown>>(source).nested = null; return relabel(source, "x"); });

// The members have other forms than plain ones.
attempt("a getter in the source", () => { const source = wide(); Object.defineProperty(source, "id", { get() { calls.push("get id"); return 11; }, enumerable: true, configurable: true }); return relabel(source, "x"); });
attempt("a member that is not enumerable", () => { const source = wide(); Object.defineProperty(source, "flag", { enumerable: false }); return relabel(source, "x"); });
attempt("a member that cannot be written", () => { const source = wide(); Object.defineProperty(source, "label", { writable: false }); return relabel(source, "x"); });
attempt("a frozen source", () => relabel(Object.freeze(wide()), "x"));
attempt("a sealed source", () => touch(Object.seal(wide()), { id: 3 }));
attempt("a source that takes no more", () => touch(Object.preventExtensions(wide()), { maybe: "new" }));
attempt("the copy of a frozen source takes stores", () => { const copy = any<Wide>(alone(Object.freeze(wide()))); copy.id = 12; any<Record<string, number>>(copy).more = 1; return copy; });

// The source is no record.
class Point { x = 1; y = 2; get sum() { return this.x + this.y; } static origin = 0; }
class Labeled extends Point { id = 3; label = "p"; }
attempt("an instance of a class", () => relabel(new Labeled(), "x"));
attempt("an object below another prototype", () => relabel(Object.setPrototypeOf(wide(), { inherited: 1 }), "x"));
attempt("an object below null", () => relabel(Object.assign(Object.create(null), { id: 1, label: "n" }), "x"));
attempt("parsed data", () => relabel(JSON.parse('{"label":"j","id":1,"z":[1]}'), "x"));
attempt("an array", () => alone(any<Fields>([1, 2])));
attempt("a string", () => alone(any<Fields>("ab")));
attempt("a number", () => alone(any<Fields>(5)));
attempt("null", () => alone(any<Fields>(null)));
attempt("undefined", () => relabel(any<Fields>(undefined), "x"));
attempt("a function with members", () => relabel(Object.assign(() => 1, { id: 1, label: "f" }), "x"));
attempt("a map", () => alone(any<Fields>(new Map([[1, 2]]))));
attempt("a proxy", () => relabel(new Proxy(wide(), {
    ownKeys(target) { calls.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { calls.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { calls.push("get " + String(key)); return Reflect.get(target, key, receiver); },
}), "x"));
attempt("an own member named __proto__", () => alone(JSON.parse('{"__proto__":{"a":1},"id":1}')));
attempt("a getter that throws", () => relabel(any<Fields>({ id: 1, get label(): string { throw new RangeError("no"); } }), "x"));
attempt("a getter that changes the source", () => {
    const source = any<Record<string, unknown>>({ id: 1, get label() { calls.push("get"); delete source.later; source.added = 1; return "g"; }, later: 2 });
    return relabel(any<Fields>(source), "x");
});

// What is done to the copy afterwards.
attempt("the copy becomes a prototype", () => { const copy = relabel(wide(), "x"); const below = Object.create(copy); below.id = 5; return [below.label, below.id, copy.id, Object.keys(below).join()].join(); });
attempt("the copy is copied again", () => relabel(relabel(relabel(wide(), "a"), "b"), "c"));
attempt("a copy with names outside the type is copied again", () => {
    const first = any<Record<PropertyKey, unknown>>(relabel(wide(), "a"));
    first.outside = 1;
    first[Symbol.for("s")] = 2;
    const second = any<Record<string, unknown>>(relabel(any<Wide>(first), "b"));
    second.further = 3;
    first.outside = "changed behind the copy";
    return relabel(any<Wide>(second), "c");
});
attempt("names outside the type in other forms", () => {
    const source = any<Record<string, unknown>>(wide());
    Object.defineProperty(source, "hiddenOutside", { value: 1, enumerable: false, configurable: true, writable: true });
    Object.defineProperty(source, "gotOutside", { get() { calls.push("get outside"); return 2; }, enumerable: true, configurable: true });
    Object.defineProperty(source, "fixedOutside", { value: 3, enumerable: true, configurable: false, writable: false });
    return relabel(any<Wide>(source), "x");
});
attempt("a frozen source with names outside the type", () => { const source = any<Record<string, unknown>>(wide()); source.outside = 1; return touch(any<Wide>(Object.freeze(source)), { id: 4 }); });
attempt("the copy gets many names", () => { const copy = any<Record<string, number>>(alone(wide())); for (let i = 0; i < 20; i++) copy["n" + i] = i; return Object.keys(copy).length + " " + copy.n19; });
attempt("members of the copy are deleted", () => { const copy = relabel(wide(), "x"); delete any<Partial<Wide>>(copy).id; delete any<Partial<Wide>>(copy).label; return copy; });
attempt("the copy is frozen", () => Object.freeze(relabel(wide(), "x")));
attempt("JSON of the copy", () => JSON.stringify(touch(wide(), { maybe: "m" })));
attempt("for-in over the copy", () => { const names: string[] = []; for (const name in relabel(wide(), "x")) names.push(name); return names.join(); });
console.log(lines.join("\n"));
