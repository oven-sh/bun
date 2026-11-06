// A template converts each value as String() does but for symbols. Numbers, booleans, undefined, null and bigints in templates: alone, between texts, as keys of a Map, with calls that run between the reads.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail;

const numbers: number[] = hide([0, -0, 1, -1, 7, 10, 99, 100, 2147483647, -2147483648, 2147483648, 4294967295, 9007199254740991, 1e21, 1e-7, 0.1, 1.5, -2.25, 123456789.125, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308]);
type Item = { id: number; on: boolean; big: bigint; maybe?: number | null };
const items: Item[] = numbers.map((n, i) => ({ id: n, on: i % 2 === 0, big: BigInt(i) ** 9n - 5n, maybe: i % 3 === 0 ? undefined : i % 3 === 1 ? null : n }));

function pair(a: Item, b: Item, state: number): string {
  const postFix = state ? ":" + state : "";
  return `${a.id},${b.id}${postFix}`;
}
function all(a: Item): string { return `${a.id}|${a.on}|${a.big}|${a.maybe}`; }
function alone(n: number): string { return `${n}`; }
function integers(i: number, j: number): string { return `${i | 0}-${j >>> 0}-${(i * j) | 0}`; }
function joined(a: number, b: boolean): string { return String(a) + String(b) + a.toString() + b; }

let order = "";
function noted<T>(name: string, value: T): T { order += name; return value; }
function withCalls(a: Item): string { return `${noted("a", a.id)}${noted("b", a.on)}${noted("c", a.big)}`; }

const texts = { toString() { order += "!"; return "object"; } };
function withObject(n: number, o: { toString(): string }, m: number): string { return `${n}${o}${m}`; }
function withUnknown(n: number, u: unknown, m: number): string { return `${n}<${u}>${m}`; }

for (const [i, item] of items.entries()) {
  const other = items[(i * 7 + 3) % items.length]!;
  lines.push(pair(item, other, i % 4 === 0 ? i : 0), all(item), alone(item.id), integers(item.id, other.id), joined(item.id, item.on), withCalls(item), withObject(item.id, texts, other.id));
}
lines.push(order);
for (const value of hide<unknown[]>([1, "s", true, null, undefined, 3n, [1, 2], { toString() { return "own"; } }, Symbol("no"), Object.create(null)])) {
  try { lines.push(withUnknown(1, value, 2)); } catch (error) { lines.push((error as Error).constructor.name); }
}

// The same keys made again and again find what was stored under them, whichever way the text was made.
const seen = new Map<string, number>();
let found = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 2000; i++) {
    const a = items[i % items.length]!, b = items[(i * 5 + round) % items.length]!;
    const key = pair(a, b, i % 8 === 0 ? 2 : 0);
    const spelled = String(a.id) + "," + String(b.id) + (i % 8 === 0 ? ":2" : "");
    if (key !== spelled) lines.push("DIFFERENT: " + key + " " + spelled);
    if (seen.has(spelled)) found++;
    seen.set(key, i);
  }
}
lines.push(found + " " + seen.size);
console.log(lines.join("\n"));
