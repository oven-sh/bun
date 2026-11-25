// The loop orders what it reads off two lists and pushes it into a list made here: whole numbers, fractions, both, minus zero and not a number, texts, holes, lists of unlike lengths, an empty one; the counter of the second list enters as a remainder, a fraction, not a number, below zero.
const said: string[] = [];
function merged(left: number[], right: number[], from: number): string {
  const out: number[] = [];
  let a = 0, b = from;
  while (a < left.length && b < right.length) out.push(left[a]! <= right[b]! ? left[a++]! : right[b++]!);
  while (a < left.length) out.push(left[a++]!);
  while (b < right.length) out.push(right[b++]!);
  return out.map(value => Object.is(value, -0) ? "-0" : String(value)).join();
}
const table: Record<string, (left: any, right: any, from: any) => string> = { merged };
const lists: any[] = JSON.parse('[[0,5,10,15,20],[0,7,14,21,28,35],[0.5,1.5,9.25],[],[3],["a","c","e"],["b","d"],[1,"2",3]]');
lists.push([-0, 0, 1], [NaN, 1, 2], [1, , 3], [2147483647, 2147483648, 9007199254740993]);
for (let turn = 0; turn < 2; turn++) for (const left of lists) for (const right of lists) for (const from of [0, turn % 3, 1]) said.push(table[JSON.parse('"merged"') as string]!(left, right, from));
for (const from of [0.5, NaN, -1, -0, 1e10, "1", null, undefined]) said.push(table[JSON.parse('"merged"') as string]!(lists[0], lists[1], from));
console.log(said.join(" | "));
export {};
