// Every way an allocation site meets its record: never used, used once, used until the allocator runs out of room, emptied because its class was evaluated again.
declare const Bun: { gc(force: boolean): void };

interface Point { x: number; y: number }
interface Named { name: string; point: Point; next: Named | null }

function literal(i: number): Point {
    return { x: i, y: i * 2 };
}

function nested(i: number, next: Named | null): Named {
    return { name: "n" + (i & 7), point: { x: i, y: -i }, next };
}

// A site that runs once only: its record is filled by the slow path and never read again.
function once(): Point {
    return { x: 41, y: 1 };
}

// Sites behind a branch that is not taken for a long time.
function late(i: number): Point | Named {
    if (i < 49_990)
        return literal(i);
    return { name: "late", point: { x: i, y: 0 }, next: null };
}

function sumChain(head: Named | null): number {
    let sum = 0;
    for (let at = head; at; at = at.next)
        sum += at.point.x + at.point.y + at.name.length;
    return sum;
}

function manyLiterals(): number {
    let sum = 0;
    for (let i = 0; i < 200_000; ++i) {
        const p = literal(i);
        sum += p.x + p.y;
    }
    return sum;
}

function chainsAcrossCollections(): number {
    let total = 0;
    for (let round = 0; round < 6; ++round) {
        let head: Named | null = null;
        for (let i = 0; i < 3_000; ++i) {
            head = nested(i, head);
            if (i === 1_500)
                Bun.gc(true);
        }
        total += sumChain(head);
    }
    return total;
}

// The class is evaluated again at every call, so the records of `new Local` are emptied and filled again, each time for another prototype.
function makeClass(tag: number) {
    class Local {
        value: number;
        other: number;
        constructor(value: number) {
            this.value = value;
            this.other = tag;
        }
        describe(): string {
            return "local" + tag + ":" + this.value + ":" + this.other;
        }
    }
    return Local;
}

function classesEvaluatedAgain(): string {
    const seen: string[] = [];
    let previous: object | null = null;
    for (let tag = 0; tag < 5; ++tag) {
        const Local = makeClass(tag);
        let last = new Local(0);
        for (let i = 1; i < 2_000; ++i)
            last = new Local(i);
        const prototype = Object.getPrototypeOf(last);
        seen.push(last.describe() + (prototype === Local.prototype ? "+" : "-") + (prototype === previous ? "same" : "new") + (last instanceof Local ? "+" : "-"));
        previous = prototype;
    }
    return seen.join(",");
}

class Base {
    a = 1;
    b = "b";
}
class Derived extends Base {
    c = 3.5;
    d: Point = { x: 1, y: 2 };
}

function instances(): number {
    let sum = 0;
    for (let i = 0; i < 50_000; ++i) {
        const o = i & 1 ? new Derived() : new Base();
        sum += o.a + o.b.length + (o instanceof Derived ? o.c + o.d.y : 0);
    }
    return sum;
}

// Closures with and without captures, and closures used as objects.
function closures(): number {
    const kept: Array<() => number> = [];
    for (let i = 0; i < 20_000; ++i) {
        const captured = i;
        const f = () => captured + 1;
        if ((i & 1023) === 0)
            kept.push(f);
        else if (f() !== i + 1)
            return -1;
    }
    let sum = 0;
    for (const f of kept)
        sum += f();
    return sum;
}

function functionObjects(): string {
    const parts: string[] = [];
    for (let i = 0; i < 3_000; ++i) {
        const f = function named(this: unknown, a: number, b: number) { return a + b + i; };
        (f as unknown as { tag: number }).tag = i;
        if (i % 1_000 === 0)
            parts.push(f.name + f.length + (f as unknown as { tag: number }).tag + ":" + f(1, 2) + ":" + typeof f.prototype);
    }
    return parts.join(",");
}

// An object that need not leave the frame, at a site that never allocates on the heap.
function staysInFrame(i: number): number {
    const p = { x: i, y: i + 1 };
    return p.x * p.y;
}

function framesOnly(): number {
    let sum = 0;
    for (let i = 0; i < 100_000; ++i)
        sum = (sum + staysInFrame(i)) % 1_000_003;
    return sum;
}

// It leaves the frame on one path in a thousand.
const escaped: Point[] = [];
function sometimesEscapes(i: number): number {
    const p = { x: i, y: 1 };
    if (i % 1_000 === 999)
        escaped.push(p);
    return p.x + p.y;
}

function copies(): number {
    let sum = 0;
    const source = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    for (let i = 0; i < 30_000; ++i) {
        const copy = { ...source };
        copy.c = i;
        const wider = { ...copy, f: i };
        sum += copy.a + copy.c + wider.e + wider.f;
    }
    return sum + source.c;
}

async function promises(): Promise<number> {
    let sum = 0;
    for (let i = 0; i < 2_000; ++i)
        sum += await Promise.resolve(i).then(v => ({ v }).v);
    return sum;
}

function* generated(n: number): Generator<Point> {
    for (let i = 0; i < n; ++i)
        yield { x: i, y: n };
}

function generators(): number {
    let sum = 0;
    for (let round = 0; round < 200; ++round) {
        for (const p of generated(20))
            sum += p.x + p.y;
    }
    return sum;
}

console.log("once", JSON.stringify(once()));
console.log("literals", manyLiterals());
console.log("chains", chainsAcrossCollections());
console.log("classes", classesEvaluatedAgain());
console.log("instances", instances());
console.log("closures", closures());
console.log("function objects", functionObjects());
console.log("frames", framesOnly());
let escapes = 0;
for (let i = 0; i < 50_000; ++i)
    escapes += sometimesEscapes(i);
console.log("escapes", escapes, escaped.length, JSON.stringify(escaped[7]));
let lateSum = 0;
for (let i = 0; i < 50_000; ++i) {
    const value = late(i);
    lateSum += "name" in value ? value.point.x : value.y;
}
console.log("late", lateSum);
console.log("copies", copies());
console.log("generators", generators());
Bun.gc(true);
console.log("after a collection", manyLiterals(), classesEvaluatedAgain().length, closures());
console.log("promises", await promises());
