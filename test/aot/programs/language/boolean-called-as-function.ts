// `Boolean(x)` is the conversion and no call, also where an array method calls it; `new Boolean(x)` makes an object.
// IR= 0 converted overload=Boolean/
// IR= 1 converted ToBoolean
// IR= 0 branch overload=Boolean/
// IR= 0 throughAlias overload=Boolean/
// IR= 1 wrapped CallBuiltin .* overload=Boolean/1
const print = (s: string) => console.log(s);
export function converted(x: unknown): boolean { return Boolean(x); }
export function branch(x: unknown): string { return Boolean(x) ? "yes" : "no"; }
export function withoutArgument(): boolean { return (Boolean as () => boolean)(); }
export function withSurplusArguments(x: unknown, log: string[]): boolean { return (Boolean as (...values: unknown[]) => boolean)(x, log.push("second"), log.push("third")); }
export function truthyOnly<T>(values: (T | null | undefined | false | 0 | "")[]): T[] { return values.filter(Boolean) as T[]; }
export function everyTruthy(values: unknown[]): boolean { return values.every(Boolean); }
export function mapped(values: unknown[]): boolean[] { return values.map(Boolean); }
export function wrapped(x: unknown): object { return new Boolean(x); }
export function throughAlias(x: unknown): boolean { const convert = Boolean; return convert(x); }

let conversions = 0;
const watched = { valueOf() { conversions++; return 0; }, toString() { conversions++; return ""; }, [Symbol.toPrimitive]() { conversions++; return 0; } };
const values: unknown[] = [
    undefined, null, true, false, 0, -0, NaN, 1, -1, 0.5, Infinity, 2 ** 53, "", " ", "0", "false", "a" + "b".repeat(3), 0n, 1n, -1n,
    Symbol.iterator, Symbol("s"), {}, [], [0], () => 0, watched, new Boolean(false), new Number(0), new String(""), new Proxy({}, {}), Object.create(null),
];
print(values.map(x => (converted(x) ? "1" : "0")).join(""));
print(values.map(branch).join(" "));
print(values.map(x => (throughAlias(x) ? "1" : "0")).join(""));
print(mapped(values).join(","));
print(String(conversions) + " " + String(withoutArgument()) + " " + String(everyTruthy(values)) + " " + String(everyTruthy([1, "a", {}])));
{ const log: string[] = []; print(String(withSurplusArguments(0, log)) + " " + log.join(",")); }
print(truthyOnly([0, 1, "", "x", null, undefined, false, 2, NaN as 0]).join(","));
print(truthyOnly<object>([null, {}, undefined, []]).length + " " + truthyOnly([]).length);
{ const w = wrapped(false); print(typeof w + " " + String(converted(w)) + " " + String((w as Boolean).valueOf()) + " " + String(w instanceof Boolean)); }
(globalThis as any).kept = [converted, branch, withoutArgument, withSurplusArguments, truthyOnly, everyTruthy, mapped, wrapped, throughAlias];
