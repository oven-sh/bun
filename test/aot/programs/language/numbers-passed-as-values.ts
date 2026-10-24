declare const console: { log(...values: unknown[]): void };
function say(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x + ":" + String(x); }
function half(x: number): number { return x / 2; }
function twice(x: number): number { return x * 2; }
function sum(x: number, y: number): number { return x + y; }
function root(x: number): number { return Math.sqrt(x); }
function asAnything(x: number): unknown { return x; }
function inArray(x: number, y: number): unknown[] { return [x / y, x * y, x - y, x % y]; }
function inObject(x: number, y: number): { [key: string]: unknown } { return { q: x / y, p: x * y }; }
function key(table: Map<unknown, string>, x: number): string | undefined { return table.get(x / 2); }
function bits(x: number): string { const f = new Float64Array(1); f[0] = x; return Array.from(new Uint8Array(f.buffer)).join(","); }
function fromBits(hi: number, lo: number): number { const u = new Uint32Array(2); u[0] = lo; u[1] = hi; return new Float64Array(u.buffer)[0]; }
const values = [0, -0, NaN, 1, -1, 3, 0.5, -0.5, 5e-324, Infinity, -Infinity, 2147483647, 2147483648, 4294967294, 4294967296, -2147483648, -2147483649, -4294967296, 1e21, -1e21, 9007199254740992, 1e308];
const out: string[] = [];
for (const v of values)
    out.push([say(asAnything(v)), say(asAnything(half(v))), say(asAnything(twice(v))), say(asAnything(sum(v, v))), say(asAnything(sum(v, 0.5))), say(asAnything(root(v))), inArray(v, 2).map(say).join("|"), JSON.stringify(inObject(v, 4))].join(" "));
console.log(out.join("\n"));
const table = new Map<unknown, string>([[1, "one"], [0, "zero"], [NaN, "nan"], [0.5, "half"], [-2147483648, "least"]]);
console.log(key(table, 2), key(table, 0), key(table, -0), key(table, NaN), key(table, 1), key(table, -4294967296), key(table, 5));
const strange = [fromBits(0x7ff80000, 1), fromBits(0xfff80000, 0), fromBits(0x7ffa0000, 0), fromBits(0x7ffb0000, 0), fromBits(0x7ffc0000, 0), fromBits(0xfffe0000, 7), fromBits(0xffffffff, 0xffffffff), fromBits(0x7ff00000, 1)];
console.log(strange.map(x => say(asAnything(x)) + " " + say(asAnything(sum(x, 1))) + " " + say(asAnything(half(x))) + " " + key(table, x)).join("\n"));
console.log(bits(-0), bits(twice(1073741824)), bits(half(1)));
