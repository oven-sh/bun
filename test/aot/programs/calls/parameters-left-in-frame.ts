type Point = { x: number; y: number; label: string };

function point(x: number, y: number, label: string): Point {
    return { x, y, label };
}

function show(p: Point): string {
    return p.label + "(" + p.x + "," + p.y + ")";
}

function twoWait(a: Point, b: Point): string {
    const first = show(a);
    const second = show(b);
    return first + second + show(a) + show(b);
}

function sixWait(a: Point, b: Point, c: Point, d: Point, e: Point, f: Point): string {
    let text = show(f);
    text += show(e);
    text += show(d);
    text += show(c);
    text += show(b);
    text += show(a);
    return text + show(a) + show(f);
}

function eightWait(a: Point, b: Point, c: Point, d: Point, e: Point, f: Point, g: Point, h: Point): string {
    const head = show(h) + show(g);
    return head + show(a) + show(b) + show(c) + show(d) + show(e) + show(f) + show(g) + show(h);
}

function changedBeforeTheCall(a: Point, b: Point, swap: boolean): string {
    if (swap) {
        const held = a;
        a = b;
        b = held;
    }
    const first = show(a);
    return first + show(b) + show(a);
}

function changedAtOnce(a: Point, b: Point): string {
    a = b;
    const first = show(a);
    return first + show(b) + show(a);
}

function numbersWait(x: number, y: number, p: Point, count: number): string {
    let text = show(p);
    for (let i = 0; i < count; i++)
        text += show(point(x + i, y - i, p.label));
    return text + x + "/" + y + "/" + count;
}

function withDefaults(a: Point, b: Point = point(7, 8, "default"), c?: Point): string {
    const first = show(a);
    return first + show(b) + (c ? show(c) : "none") + show(a);
}

function loopsFromItsStart(p: Point, n: number): number {
    let sum = 0;
    while (n > 0) {
        sum += show(p).length;
        n--;
    }
    return sum;
}

class Holder {
    constructor(public inner: Point) {}
    join(a: Point, b: Point): string {
        const first = show(this.inner);
        return first + show(a) + show(b) + show(this.inner);
    }
}

function untypedLike(a: any, b: any, c: any): string {
    const first = String(a.label);
    const second = String(b.label);
    return first + second + String(c.label) + a.x + b.y + c.x;
}

function recursion(a: Point, b: Point, depth: number): string {
    if (!depth)
        return show(a);
    const below = recursion(b, a, depth - 1);
    return show(a) + below + show(b) + depth;
}

function throwsLate(a: Point, b: Point): string {
    const first = show(a);
    if (b.x < 0)
        throw new Error(first + show(b));
    return first + show(b);
}

const p = [0, 1, 2, 3, 4, 5, 6, 7].map(i => point(i, i * i, "p" + i));
console.log(twoWait(p[0], p[1]));
console.log(sixWait(p[0], p[1], p[2], p[3], p[4], p[5]));
console.log(eightWait(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]));
console.log(changedBeforeTheCall(p[1], p[2], true), changedBeforeTheCall(p[1], p[2], false), changedAtOnce(p[3], p[4]));
console.log(numbersWait(1.5, 2.5, p[5], 3));
console.log(withDefaults(p[1]), withDefaults(p[1], p[2]), withDefaults(p[1], undefined, p[3]));
console.log(loopsFromItsStart(p[6], 4), new Holder(p[7]).join(p[0], p[1]));
console.log(untypedLike(p[1], p[2], p[3]), recursion(p[4], p[5], 5));
try {
    console.log(throwsLate(p[1], point(-1, 0, "negative")));
} catch (error) {
    console.log("caught", (error as Error).message);
}
