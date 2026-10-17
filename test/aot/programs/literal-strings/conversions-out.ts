// A value of a union of string literals goes everywhere a string goes.
type Color = "red" | "green" | "blue" | "";
interface Paint { color: Color; next?: Color; other: Color | null }

function paint(color: Color, other: Color | null): Paint {
    return { color, other };
}
function describe(p: Paint): string {
    return `${p.color}/${p.next}/${p.other}`;
}
function lengthOf(c: Color): number {
    return c.length;
}
function upper(c: Color): string {
    return c.toUpperCase();
}
function first(c: Color): string | undefined {
    return c[0];
}
function isSet(c: Color): boolean {
    return c ? true : false;
}
function orDefault(c: Color | undefined): Color {
    return c || "green";
}
function orFallback(c: Color | undefined | null): Color {
    return c ?? "blue";
}
function kindOf(c: Color | undefined): string {
    return typeof c;
}
function before(a: Color, b: Color): boolean {
    return a < b;
}
function plus(a: Color, b: Color): string {
    return a + b;
}
function anything(c: Color): unknown {
    return c;
}
function loosely(c: Color | null | undefined): boolean {
    return c == null;
}
function looselyEqual(a: Color, b: string): boolean {
    return a == b;
}
const table: Record<Color, number> = { red: 1, green: 2, blue: 3, "": 0 };
function lookUp(c: Color): number {
    return table[c];
}
function has(c: Color): boolean {
    return c in table;
}

const all: Color[] = ["red", "green", "blue", ""];
const paints = all.map((c, i) => paint(c, i % 2 ? null : all[(i + 1) % 4]));
paints[1].next = "red";
paints[2].next = paints[0].color;
for (const p of paints) {
    console.log(describe(p), lengthOf(p.color), upper(p.color), first(p.color), isSet(p.color), orDefault(p.next), orFallback(p.other), kindOf(p.next), lookUp(p.color), has(p.color));
    console.log(JSON.stringify(p), Object.keys(p).join(), Object.values(p).join("|"), Object.entries(p).length, String(p.color), [p.color, p.other].join("+"));
    console.log(anything(p.color), loosely(p.other), loosely(p.next), looselyEqual(p.color, "red"), looselyEqual(p.color, ""));
}
console.log(before("blue", "green"), before("red", "blue"), before("", "red"), plus("red", "blue"), plus("", ""));
console.log([...all].sort().join(), [...all].sort((a, b) => b.localeCompare(a)).join(), all.includes("blue"), all.indexOf("green"));
const seen = new Set<Color>(all);
const count = new Map<Color, number>();
for (const p of paints) count.set(p.color, (count.get(p.color) ?? 0) + 1);
console.log(seen.has("red"), seen.size, [...count.keys()].join(), count.get(""));
const copy = { ...paints[1] };
const assigned = Object.assign({}, paints[2]);
const cloned = structuredClone(paints[1]);
console.log(copy.color, copy.next, assigned.next, cloned.color, cloned.next, cloned.other);
delete paints[1].next;
console.log(paints[1].next, "next" in paints[1], describe(paints[1]));
console.log(JSON.stringify(paints));
