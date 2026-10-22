// A closure that another closure captures lies in the frame when the capturing closure does and only calls it.
// IR= 2 bothInTheFrame NewClosure .* storage=Frame
// IR= 3 threeDeep NewClosure .* storage=Frame
// IR= 0 outerIsKept NewClosure .* storage=Frame
// IR= 1 innerIsKeptByTheOuter NewClosure .* storage=Frame
// IR= 1 innerIsReturnedByTheOuter NewClosure .* storage=Frame
// IR= 1 innerIsComparedByTheOuter NewClosure .* storage=Frame
// IR= 0 carriedAcrossIterations NewClosure .* storage=Frame
// IR= 2 throwsThrough NewClosure .* storage=Frame
let noise = 0;
function pad(k: number): void { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
type Test = (x: number) => boolean;
const kept: Test[] = [];
function each(list: number[], f: Test): number {
  pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8);
  let count = 0;
  for (let i = 0; i < list.length; i++) { if (f(list[i])) count++; if (list[i] > 1e9) count += each(list, f); }
  return count;
}
function keeps(list: number[], f: Test): number {
  pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8);
  kept.push(f);
  let count = 0;
  for (let i = 0; i < list.length; i++) { if (f(list[i])) count++; if (list[i] > 1e9) count += keeps(list, f); }
  return count;
}
function evenOr(list: number[], f: Test): number { return each(list, x => x % 2 === 0 || f(x)); }
function thirdAnd(list: number[], f: Test): number { return evenOr(list, x => x % 3 === 0 && f(x)); }
function evenOrKept(list: number[], f: Test): number { return keeps(list, x => x % 2 === 0 || f(x)); }
function keepsAt(list: number[], f: Test, at: number): number { return each(list, x => { if (x === at) kept.push(f); return f(x); }); }
function givesAt(list: number[], f: Test, at: number): number {
  let count = 0;
  for (let i = 0; i < list.length; i++) { const got = call(x => x === at ? f : undefined, list[i]); if (got) { kept.push(got); count += got(list[i] + 1) ? 1 : 0; } }
  return count;
}
function call(give: (x: number) => Test | undefined, x: number): Test | undefined {
  pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8);
  if (x > 1e9) call(give, x - 1);
  return give(x);
}
let lastSeen: unknown;
function comparesWithLast(list: number[], f: Test): number { return each(list, x => { const same = lastSeen === f; lastSeen = x % 2 ? f : x; return same; }); }
function bothInTheFrame(list: number[], limit: number): number {
  if (limit > 1e9) bothInTheFrame(list, limit - 1);
  let calls = 0;
  return evenOr(list, x => { calls++; return x > limit; }) * 100 + calls;
}
function threeDeep(list: number[], limit: number): number {
  if (limit > 1e9) threeDeep(list, limit - 1);
  let calls = 0;
  return thirdAnd(list, x => { calls++; return x > limit; }) * 100 + calls;
}
function outerIsKept(list: number[], limit: number): number {
  if (limit > 1e9) outerIsKept(list, limit - 1);
  let calls = 0;
  return evenOrKept(list, x => { calls++; return x > limit; }) * 100 + calls;
}
function innerIsKeptByTheOuter(list: number[], limit: number): number {
  if (limit > 1e9) innerIsKeptByTheOuter(list, limit - 1);
  let calls = 0;
  return keepsAt(list, x => { calls++; return x > limit; }, limit) * 100 + calls;
}
function innerIsReturnedByTheOuter(list: number[], limit: number): number {
  if (limit > 1e9) innerIsReturnedByTheOuter(list, limit - 1);
  let calls = 0;
  return givesAt(list, x => { calls++; return x > limit; }, limit) * 100 + calls;
}
function innerIsComparedByTheOuter(list: number[], limit: number): number {
  if (limit > 1e9) innerIsComparedByTheOuter(list, limit - 1);
  return comparesWithLast(list, x => x > limit);
}
function carriedAcrossIterations(list: number[], limit: number): number {
  if (limit > 1e9) carriedAcrossIterations(list, limit - 1);
  let previous: Test | undefined;
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const least = list[i] + limit;
    const inner: Test = i % 2 ? x => x > least : x => x < least;
    const before = previous;
    const outer: Test = x => inner(x) || (before !== undefined && before(x - 1));
    count += each(list, outer);
    previous = outer;
  }
  return count;
}
function throwsThrough(list: number[], limit: number): string {
  if (limit > 1e9) throwsThrough(list, limit - 1);
  let calls = 0;
  try { return "" + evenOr(list, x => { calls++; if (x === limit) throw new Error("at " + x); return x > limit; }); } catch (e) { return (e as Error).message + ":" + calls; }
}
function* yieldsBetween(list: number[], limit: number): Generator<number> {
  let calls = 0;
  const inner: Test = limit % 2 ? x => { calls++; return x > limit; } : x => { calls += 2; return x < limit; };
  const outer: Test = x => x % 2 === 0 || inner(x);
  yield each(list, outer);
  yield each(list, outer) + calls;
}
async function awaitsBetween(list: number[], limit: number): Promise<number> {
  let calls = 0;
  const inner: Test = limit % 2 ? x => { calls++; return x > limit; } : x => { calls += 2; return x < limit; };
  const outer: Test = x => x % 2 === 0 || inner(x);
  const first = each(list, outer);
  await null;
  return first + each(list, outer) + calls;
}
const data = [1, 2, 3, 4, 5, 6, 7, 9, 11];
let out = "";
for (let i = 0; i < 150; i++) {
  const k = i % 8;
  const line = [bothInTheFrame(data, k), threeDeep(data, k), outerIsKept(data, k), innerIsKeptByTheOuter(data, k), innerIsReturnedByTheOuter(data, k), innerIsComparedByTheOuter(data, k), carriedAcrossIterations(data, k), throwsThrough(data, i % 12), [...yieldsBetween(data, k)].join("+")].join(" ");
  if (i % 29 === 0) out += line + "\n";
  if (kept.length > 60) { let late = 0; for (const f of kept) late += f(i % 10) ? 1 : 0; out += "late " + late + "\n"; kept.length = 0; }
}
console.log(out + noise);
awaitsBetween(data, 4).then(n => awaitsBetween(data, 5).then(m => console.log("awaited", n, m)));
