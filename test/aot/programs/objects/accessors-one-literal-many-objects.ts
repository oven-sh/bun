// Many objects made by one object literal that mixes data members and getters are read at the same places; some get more properties, some lose them, most become garbage.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
interface Point { x: number; y: number; readonly sum: number; readonly name: string }
function point(x: number, y: number): Point { return { x, y, get sum() { return this.x + this.y; }, get name() { return "p" + this.x; } }; }
function sumOf(from: Point): number { return from.sum; }
function nameOf(from: Point): string { return from.name; }
function tagOf(from: any): unknown { return from.tag; }

const points: Point[] = [];
for (let i = 0; i < 300; i++) points.push(point(i, 2 * i));
let total = 0;
for (let round = 0; round < 20; round++) for (const one of points) total += sumOf(one) + nameOf(one).length;
say("three hundred objects, two getters", total);
let tags = 0;
for (let round = 0; round < 20; round++) for (const one of points) if (tagOf(one) === undefined) tags++;
say("a name none of them has", tags);
for (let i = 0; i < points.length; i += 3) (points[i] as any).tag = i;
tags = 0;
for (let round = 0; round < 20; round++) for (const one of points) { const tag = tagOf(one); if (typeof tag === "number") tags += tag; }
say("every third has it now", tags);
for (let i = 0; i < points.length; i += 6) delete (points[i] as any).tag;
for (let i = 1; i < points.length; i += 50) Object.defineProperty(points[i], "sum", { get() { return -1; }, enumerable: true, configurable: true });
total = 0; tags = 0;
for (let round = 0; round < 20; round++) for (const one of points) { total += sumOf(one); const tag = tagOf(one); if (typeof tag === "number") tags += tag; }
say("some lost it, some have another getter", total + " " + tags);

interface Wide { base: number; readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number; readonly g: number; readonly h: number; readonly i: number }
function wide(base: number): Wide {
    return { base, get a() { return this.base + 1; }, get b() { return this.base + 2; }, get c() { return this.base + 3; }, get d() { return this.base + 4; }, get e() { return this.base + 5; },
        get f() { return this.base + 6; }, get g() { return this.base + 7; }, get h() { return this.base + 8; }, get i() { return this.base + 9; } };
}
function endsOf(from: Wide): number { return from.a * 1000 + from.h * 10 + from.i; }
const wides: Wide[] = [];
for (let i = 0; i < 40; i++) wides.push(wide(i));
total = 0;
for (let round = 0; round < 50; round++) for (const one of wides) total += endsOf(one);
say("nine getters in one literal", total);
for (const one of wides) for (let k = 0; k < 10; k++) (one as any)["more" + k] = k + one.base;
function lastOf(from: any): number { return from.more9 + from.more0; }
total = 0;
for (let round = 0; round < 50; round++) for (const one of wides) total += lastOf(one) + endsOf(one);
say("and ten values more", total);

let checked = 0;
for (let wave = 0; wave < 60; wave++) {
    const short: Point[] = [];
    for (let i = 0; i < 400; i++) { const made = point(i, wave); (made as any)["only" + wave] = wave; if (i % 2) (made as any).tag = wave; short.push(made); }
    for (const one of short) { checked += sumOf(one); const tag = tagOf(one); if (typeof tag === "number") checked += tag; }
    for (const one of points) checked += sumOf(one) > 0 ? 1 : 0;
}
say("waves of objects whose properties nobody else has", checked);
console.log(lines.join("\n"));
