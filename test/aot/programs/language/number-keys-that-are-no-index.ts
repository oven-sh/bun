// Number keys that are no index of an array (negative, with a fraction, too large, not a number), where the array has a property of just that name: read, written and asked for, with the key out of a field, a sum, a parameter.
declare const console: { log(...values: unknown[]): void };
class Span { kind!: number; pos!: number; end!: number; id!: number; next!: number; line!: number; column!: number; depth!: number; }
function makeSpan(pos: number, end: number): Span { const n = new Span(); n.kind = 1; n.pos = pos; n.end = end; n.id = 0; n.next = 0; n.line = 0; n.column = 0; n.depth = 0; return n; }
class Holder { key = 0.5; }
const odd = JSON.parse("[-1, -2, -3, -7, -1073741824, -1073741825, -2147483647, -2147483648, -2147483649, -4294967295, -4294967296, 0.5, 1.5, -0.5, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740992, 1e21]") as number[];
odd.push(NaN, Infinity, -Infinity, -0, 0, 1, 3, 4, 5);
const names: string[] = ["n0", "n1", "n2", "n3"]; const counts: number[] = [10, 11, 12, 13]; const halves: number[] = [0.5, 1.5, 2.5, 3.5]; const spans: Span[] = [makeSpan(0, 0), makeSpan(1, 1)];
for (const list of [names, counts, halves, spans] as unknown as Record<string, unknown>[]) for (const key of odd) if (!(key >= 0 && key < 4294967295 && Math.floor(key) === key)) list[String(key)] = list === (names as unknown) ? "p" + key : list === (spans as unknown) ? spans[0] : 1000.5;
function nameAt(n: Span): string | undefined { return names[n.pos]; }
function nameBefore(n: Span): string | undefined { return names[n.pos - 1]; }
function nameBetween(n: Span): string | undefined { return names[n.end - n.pos]; }
function nameHalf(n: Span): string | undefined { return names[n.pos / 2]; }
function nameBy(h: Holder): string | undefined { return names[h.key]; }
function nameOf(key: number): string | undefined { return names[key]; }
function countAt(n: Span): number | undefined { return counts[n.pos]; }
function countBefore(n: Span): number | undefined { return counts[n.pos - 1]; }
function halfBy(h: Holder): number | undefined { return halves[h.key]; }
function spanAt(n: Span): string { const s = spans[n.pos]; return s ? "s" + s.pos : "none"; }
function spanBefore(n: Span): string { const s = spans[n.pos - 2]; return s ? "s" + s.pos : "none"; }
function has(n: Span): boolean { return n.pos in names; }
function write(n: Span, list: string[]): string { list[n.pos] = "w"; return list.length + ":" + Object.keys(list).length; }
const bySpan: [string, (n: Span) => unknown][] = [["nameAt", nameAt], ["nameBefore", nameBefore], ["nameBetween", nameBetween], ["nameHalf", nameHalf], ["countAt", countAt], ["countBefore", countBefore], ["spanAt", spanAt], ["spanBefore", spanBefore], ["has", has], ["write", n => n.pos < 100 || n.pos !== n.pos || n.pos > 4294967294 ? write(n, ["a", "b"]) : "skipped"]];
const all = odd.map((key, i) => { const n = makeSpan(1, 2); n.pos = key; n.end = odd[(i * 5 + 2) % odd.length]; return n; });
for (const [name, f] of bySpan) console.log(name, all.map(n => String(f(n))).join(" "));
const holder = new Holder();
console.log("nameBy", odd.map(key => { holder.key = key; return String(nameBy(holder)); }).join(" "));
console.log("halfBy", odd.map(key => { holder.key = key; return String(halfBy(holder)); }).join(" "));
const fns = [nameOf]; for (const f of fns) console.log("nameOf", odd.map(key => String(f(key))).join(" "));
