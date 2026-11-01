// Types around unions of string literals: what is widened, what is a key, what is generic. A string that is no member of the union passes a cast to it. Handed on to a parameter that is written `never`, it throws a TypeError there.
type Size = "s" | "m" | "l";
type Loose = Size | (string & {});
type Prefixed = `size-${Size}`;
type Both = Size | 1 | 2;
type Flag = "yes" | "no" | boolean;
const sizes = { small: "s", medium: "m", large: "l" } as const;
type FromObject = (typeof sizes)[keyof typeof sizes];
type Keys = keyof typeof sizes;

function widened(): string {
    let s = "s";
    s += "m";
    return s;
}
function identity<T extends string>(value: T): T {
    return value;
}
function firstOf<T>(values: T[]): T {
    return values[0];
}
function loose(value: Loose): boolean {
    return value === "m";
}
function prefixed(size: Size): Prefixed {
    return `size-${size}`;
}
function isLargePrefixed(p: Prefixed): boolean {
    return p === "size-l";
}
function both(value: Both): string {
    return value === "s" ? "small" : value === 1 ? "one" : typeof value;
}
function flag(value: Flag): string {
    return value === "yes" || value === true ? "on" : value === "no" ? "off" : "false";
}
function fromObject(value: FromObject): number {
    return value === sizes.small ? 0 : value === sizes.medium ? 1 : 2;
}
function byKey(key: Keys): Size {
    return sizes[key];
}
function count(record: Partial<Record<Size, number>>, size: Size): number {
    return (record[size] ?? 0) + 1;
}
function overlap(a: "s" | "m", b: "m" | "l"): boolean {
    return a === b;
}
function narrow(value: Size | number | undefined): string {
    if (typeof value === "string")
        return value === "l" ? "large" : "text " + value;
    return String(value);
}
function assertNever(value: never): never {
    throw new Error("unexpected " + value);
}
function attempt(run: () => unknown): unknown {
    try { return run(); } catch (error) { return (error as Error).constructor.name; }
}
function exhaustive(size: Size): number {
    switch (size) {
        case "s": return 1;
        case "m": return 2;
        case "l": return 3;
        default: return assertNever(size);
    }
}

console.log(widened(), identity<Size>("m"), identity("free"), firstOf<Size>(["l", "s"]), loose("m"), loose("anything"), prefixed("l"), isLargePrefixed(prefixed("l")), isLargePrefixed(prefixed("s")));
console.log(both("s"), both("m"), both(1), both(2), flag("yes"), flag(true), flag("no"), flag(false));
console.log(fromObject("s"), fromObject(sizes.medium), fromObject("l"), byKey("small"), byKey("large"), Object.keys(sizes).map(k => byKey(k as Keys)).join());
const tally: Partial<Record<Size, number>> = {};
for (const size of ["s", "m", "s", "l", "s"] as Size[]) tally[size] = count(tally, size);
console.log(JSON.stringify(tally), overlap("m", "m"), overlap("s", "m"), narrow("l"), narrow("s"), narrow(4), narrow(undefined));
console.log(exhaustive("s") + exhaustive("m") + exhaustive("l"));
try {
    exhaustive("xl" as Size);
} catch (error) {
    console.log((error as Error).constructor.name);
}
for (const key in sizes) console.log(key, sizes[key as Keys]);
const order: Size[] = ["m", "l", "s"];
order.sort((a, b) => exhaustive(a) - exhaustive(b));
console.log(order.join(""), order.map(identity).join(""), order.filter(s => s !== "m").length, order.find(s => s === "l"), attempt(() => order.some(s => s === ("x" as Size))));
