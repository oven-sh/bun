// Six key orders of one type, each a prefix of the next, so that some share an arm of the serializer, and a toJSON that adds, deletes or replaces trailing members during the write. Every line prints what plain Bun prints.
// STATISTIC: SerializersCreated >= 1
declare const console: { log(...values: unknown[]): void };
interface Inner { x: number }
interface Deep { inner: Inner; a?: number; b?: number; c?: number; d?: string; e?: Inner }

function make(kind: number, i: number): Deep {
    switch (kind) {
    case 0: return { inner: { x: i } };
    case 1: return { inner: { x: i }, a: 1 };
    case 2: return { inner: { x: i }, a: 1, b: 2 };
    case 3: return { inner: { x: i }, a: 1, b: 2, c: 3 };
    case 4: return { inner: { x: i }, a: 1, b: 2, c: 3, d: "d" };
    default: return { inner: { x: i }, a: 1, b: 2, c: 3, d: "d", e: { x: -i } };
    }
}
function write(value: Deep): string { return JSON.stringify(value); }

const seen = new Set<string>();
for (let i = 0; i < 6000; i++) seen.add(write(make(i % 6, i & 1)));
const out: unknown[] = [...seen].sort();

for (let kind = 0; kind < 6; kind++) {
    const grows = make(kind, 7);
    (grows.inner as any).toJSON = function () {
        if (grows.a === undefined) grows.a = 10; else if (grows.b === undefined) grows.b = 20; else if (grows.c === undefined) grows.c = 30; else if (grows.d === undefined) grows.d = "grown"; else if (grows.e === undefined) grows.e = { x: 50 };
        return "grows";
    };
    out.push(write(grows), write(grows));

    const shrinks = make(kind, 8);
    (shrinks.inner as any).toJSON = function () {
        if (shrinks.e !== undefined) delete shrinks.e; else if (shrinks.d !== undefined) delete shrinks.d; else if (shrinks.c !== undefined) delete shrinks.c; else if (shrinks.b !== undefined) delete shrinks.b; else delete shrinks.a;
        return "shrinks";
    };
    out.push(write(shrinks), write(shrinks));

    const replaced = make(kind, 9);
    (replaced.inner as any).toJSON = function () { replaced.a = 100; replaced.d = undefined; return "replaced"; };
    out.push(write(replaced), write(replaced));

    const deletedAndAdded = make(kind, 6);
    (deletedAndAdded.inner as any).toJSON = function () {
        const keys = Object.keys(deletedAndAdded);
        const last = keys[keys.length - 1] as keyof Deep;
        if (last !== "inner") { const value = deletedAndAdded[last]; delete deletedAndAdded[last]; (deletedAndAdded as any)[last] = value; }
        return "same order";
    };
    out.push(write(deletedAndAdded));

    const holdsUndefined = make(kind, 5);
    if (kind >= 3) holdsUndefined.c = undefined;
    if (kind >= 4) holdsUndefined.d = undefined;
    out.push(write(holdsUndefined));

    const inherits = make(kind, 4);
    Object.setPrototypeOf(inherits, { d: "inherited", e: { x: 1 } });
    out.push(write(inherits));
}
console.log(out.map(String).join("\n"));
