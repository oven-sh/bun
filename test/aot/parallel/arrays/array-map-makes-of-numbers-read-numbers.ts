// `list.map(v => (v + k) | 0)[0]` with a list of which nothing is proven: the array that map makes takes numbers only and is read as a number[], so it is allocated with storage for
// numbers. It is an ordinary array all the same: holes stay holes, and whatever is stored into it later is found again.
const hidden = (value: unknown): any => JSON.parse(JSON.stringify(value));
function firstOfMapped(list: number[], k: number): number {
  return list.map((v: number): number => (v + k) | 0)[0]!;
}
function mapped(list: number[], k: number): number[] {
  const result = list.map((v: number): number => (v + k) | 0);
  if (result[0]! > 1000) return [];
  return result;
}
function halves(list: number[]): number {
  return list.map((v: number): number => v / 2)[1]!;
}
function notNumbers(list: number[]): number {
  return list.map((v: number): number => v / 0 - v / 0)[0]!;
}
function describe(list: unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? typeof list[i] + ":" + String(list[i]) : "hole");
  return list.length + " [" + parts.join(", ") + "] " + JSON.stringify(list);
}
const sparse: number[] = [1, 2, 3, 4];
delete (sparse as any)[1];
for (let round = 0; round < 3; round++) {
  const list: number[] = hidden([round + 1, 2, 3]);
  console.log(firstOfMapped(list, round), firstOfMapped(hidden([]), 1), firstOfMapped(hidden([1.5, 2]), 1), firstOfMapped(sparse, round));
  console.log(halves(list), halves(hidden([7])), notNumbers(list));
  const result = mapped(list, 10);
  console.log(describe(result), describe(mapped(sparse, 1)), describe(mapped(hidden([]), 1)));
  (result as unknown[]).push("text");
  result[0] = 0.5;
  (result as unknown[])[1] = { a: round };
  result[6] = -0;
  console.log(describe(result), Object.is(result[6], -0), result.indexOf(0.5), result.includes(NaN));
  const frozen = Object.freeze(mapped(list, 1));
  try { (frozen as number[])[0] = 9; console.log("stored"); } catch (error) { console.log((error as Error).name); }
  console.log(describe(frozen as number[]), mapped(hidden(["a", "b"]), 1).join());
}
