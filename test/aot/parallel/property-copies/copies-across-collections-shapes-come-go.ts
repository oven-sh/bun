// Copies across collections and shapes that come and go.
const lines: string[] = [];
const describe = (value: object) => Reflect.ownKeys(value).map(key => String(key) + "=" + JSON.stringify((value as Record<PropertyKey, unknown>)[key])).join(" ") + (Object.getPrototypeOf(value) === Object.prototype ? "" : " OTHER PROTOTYPE") + (Object.isExtensible(value) ? "" : " NOT EXTENSIBLE");
const copy = <T extends object>(source: T): T => ({ ...source });
const collect = (globalThis as { Bun?: { gc(full: boolean): void } }).Bun?.gc ?? (() => {});

let wrong = 0;
for (let round = 0; round < 40; round++) {
  const made: object[] = [];
  for (let i = 0; i < 60; i++) {
    const source: Record<string, unknown> = {};
    const names = 1 + ((round * 7 + i) % 9);
    for (let n = 0; n < names; n++) source["n" + round + "_" + (i % 5) + "_" + n] = n % 3 ? "t" + n : { deep: n };
    const first = copy(source), second = copy(source), third = copy(second);
    if (describe(first) !== describe(source) || describe(second) !== describe(source) || describe(third) !== describe(source)) wrong++;
    if (first === source || second === first || (names > 0 && first["n" + round + "_" + (i % 5) + "_0"] !== source["n" + round + "_" + (i % 5) + "_0"])) wrong++;
    first.added = round;
    if ("added" in source || "added" in second) wrong++;
    made.push(third);
  }
  if (round % 3 === 0) collect(round % 6 === 0);
  for (const kept of made) if (describe(copy(kept)) !== describe(kept)) wrong++;
}
lines.push("wrong " + wrong);

const above = { above: 1 };
function churn(round: number): number {
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const plain: Record<string, unknown> = {};
    plain["p" + round + "_" + i] = i;
    if (describe(copy(plain)) !== describe(copy(plain))) bad++;
  }
  collect(true);
  collect(true);
  for (let i = 0; i < 1600; i++) {
    const hidden = Object.defineProperty({}, "h" + round + "_" + i, { value: i, enumerable: false, writable: true, configurable: true });
    if (Reflect.ownKeys(copy(hidden)).length) bad++;
    const below = Object.create(above) as Record<string, unknown>;
    below["b" + round + "_" + i] = i;
    if (Object.getPrototypeOf(copy(below)) !== Object.prototype) bad++;
    const computed = Object.defineProperty({}, "g" + round + "_" + i, { get: () => i, enumerable: true, configurable: true });
    if (Object.getOwnPropertyDescriptor(copy(computed), "g" + round + "_" + i)!.value !== i) bad++;
  }
  return bad;
}
let churned = 0;
for (let round = 0; round < 6; round++) churned += churn(round);
lines.push("churned " + churned);

type Wire = { type: string; index: number; text?: string; inner?: { n: number }; big?: number };
const records: Wire[] = [{ type: "a", index: 0 }, { type: "b", index: 1, text: "x" }, { type: "c", index: 2, inner: { n: 1 } }, { type: "d", index: 2 ** 40, big: 0.5 }, { index: 4, type: "e" }];
records[1]!.inner = { n: 2 };
delete records[2]!.inner;
for (const record of records) {
  const first = copy(record), second = copy(first);
  lines.push(describe(record) + " | " + describe(first) + " | " + describe(second) + " | " + (first.inner === record.inner));
  first.index = -1; first.text = "changed";
  lines.push(describe(record) + " | " + describe(second));
}
const odd: object[] = [Object.freeze({ a: 1, b: 2 }), Object.seal({ a: 1 }), Object.preventExtensions({ a: 1 }), Object.freeze({ type: "f", index: 9 } as Wire), Object.assign({ a: 1 }, { 0: "zero", 1: "one" }), Object.defineProperty({ a: 1 }, "hidden", { value: 2 }), { get g() { return 7; }, a: 1 }, Object.create({ above: 1 }), Object.assign(Object.create({ above: 1 }) as object, { own: 2 }), {}, { __proto__: null, bare: 1 }, JSON.parse('{"__proto__":1,"a":2}'), Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["k" + i, i]))];
for (let round = 0; round < 3; round++) for (const source of odd) lines.push(describe(copy(source)));
const prototype = { shared: 1, other: 2 };
lines.push(describe(copy(prototype)));
class Below {} Object.setPrototypeOf(Below.prototype, prototype);
lines.push(describe(copy(prototype)) + " | " + (new Below() as unknown as { shared: number }).shared);
let sum = 0;
for (let i = 0; i < 200000; i++) { const made = copy(records[i % 5]!); sum += made.index === records[i % 5]!.index ? 1 : 0; if (i % 50000 === 0) collect(true); }
lines.push("sum " + sum);
console.log(lines.join("\n"));
