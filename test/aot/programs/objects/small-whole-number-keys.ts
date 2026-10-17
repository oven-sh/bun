// Maps and Sets keyed by small whole numbers beside every other kind of key: the order of insertion, growth, shrinking, deletion and the same table seen by typed and by untyped code.
const lines: string[] = [];
function digest(keys: Iterable<unknown>): string {
  let sum = 0;
  let n = 0;
  for (const k of keys) sum = (sum * 31 + (typeof k === "number" ? (Number.isFinite(k) ? Math.floor(k * 4) % 100003 : 11) : String(k).length) + ++n) % 1000003;
  return n + ":" + sum;
}
function dense(n: number): string {
  const table = new Map<number, number>();
  for (let i = 0; i < n; i++) table.set(i, i * 2);
  let total = 0;
  for (let r = 0; r < 3; r++) for (let i = -3; i < n + 3; i++) total += table.get(i) ?? -1;
  for (let i = 0; i < n; i += 3) table.delete(i);
  for (let i = -3; i < n + 3; i++) total += table.has(i) ? 1 : 0;
  for (let i = n; i-- > 0; ) if (i % 6 === 0) table.set(i, -i);
  return total + ":" + digest(table.keys()) + ":" + digest(table.values());
}
function strided(step: number, n: number): string {
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) seen.add(i * step);
  let hits = 0;
  for (let i = 0; i < n * step; i += 7) if (seen.has(i)) hits++;
  return hits + ":" + digest(seen);
}
function mixedKinds(): string {
  const table = new Map<unknown, number>();
  const keys: unknown[] = [0, -0, 1, 2, 3, 7, 8, 15, 16, 31, 32, 33, 63, 64, 65, 1000, 2147483647, -1, -2147483648, 0.5, 1.5, 4294967296, NaN, "0", "1", "7", true, false, null, undefined, 1n, 7n];
  const own = {};
  keys.push(own, [], Symbol.iterator);
  for (let r = 0; r < 3; r++) keys.forEach((k, i) => table.set(k, (table.get(k) ?? 0) + i));
  const typed = table as Map<number, number>;
  let sum = 0;
  for (let i = -2; i < 70; i++) sum += typed.get(i) ?? 0;
  for (let i = 0; i < 200; i++) typed.set(i * 3, i);
  for (let i = -2; i < 70; i++) sum += typed.get(i) ?? 0;
  const loose: any = table;
  for (let i = 0; i < 70; i++) sum += loose.get(i) ?? 0;
  for (let i = 0; i < 600; i += 2) loose.delete(i);
  for (let i = 0; i < 70; i++) sum += (typed.has(i) ? 1 : 0) + (loose.has(i) ? 2 : 0);
  return sum + ":" + digest(table.keys()) + ":" + table.size;
}
function shrinks(): string {
  const table = new Map<number, string>();
  for (let i = 0; i < 5000; i++) table.set(i, "v" + i);
  for (let i = 0; i < 4990; i++) table.delete(i);
  let found = "";
  for (let i = 4980; i < 5005; i++) found += table.get(i) ?? "-";
  for (let i = 0; i < 40; i++) table.set(i * 100, "w");
  return found + ":" + digest(table.keys());
}
function copies(): string {
  const first = new Map<number, number>();
  for (let i = 0; i < 300; i++) first.set((i * 37) % 301, i);
  const second = new Map(first);
  const third = new Set(first.keys());
  second.delete(5);
  let sum = 0;
  for (let i = 0; i < 310; i++) sum += (first.get(i) ?? 0) + (second.get(i) ?? 0) * 2 + (third.has(i) ? 1 : 0);
  return sum + ":" + digest(second.keys()) + ":" + digest(third);
}
lines.push(dense(1), dense(7), dense(8), dense(9), dense(100), dense(5000), dense(70000));
lines.push(strided(1, 500), strided(2, 500), strided(64, 500), strided(1024, 300), strided(65536, 200), mixedKinds(), shrinks(), copies());
console.log(lines.join("\n"));
