// The JSON text of a list is joined behind a text that leaves four million characters below the longest string. The elements of the list hold members that their type does not declare, and their texts take half of what is left, most of it, or more than all of it.
// COUNTER: operationAOTStringBuilderAppendJSON = 472
// Env: JSC_aotCountsPath=/dev/null
type Row = { label: string };
type Pair = { id: number; text: string };
function joinRows(head: string, rows: Row[]): number {
  return (head + JSON.stringify(rows)).length;
}
function joinPairs(head: string, pairs: Pair[]): number {
  return (head + JSON.stringify(pairs)).length;
}
function parseRows(label: string, more: string): Row[] {
  return JSON.parse('[{"id":1,"label":"a","ok":true},{"id":2,"label":"' + label + '","more":"' + more + '","ok":false}]') as Row[];
}
function makePair(key: string, text: string): Pair {
  const pair: Pair = { id: 1, text };
  (pair as any)[key] = 7;
  return pair;
}
function attempt(join: () => number): string {
  try {
    return String(join());
  } catch (error) {
    return (error as Error).name;
  }
}

const shortRows = parseRows("b", "c");
const shortPairs = [makePair("first", "a"), makePair("second", "b")];
let sum = 0;
for (let turn = 0; turn < 100; turn++) sum += joinRows("head", shortRows) + joinPairs("head", shortPairs);
console.log(sum);

let piece = "x".repeat(1 << 16);
let head = "";
for (let bit = 16; bit < 31; bit++) {
  if (bit >= 22) head = head + piece;
  if (bit < 30) piece = piece + piece;
}
const left = 2 ** 31 - 1 - head.length;
console.log(head.length, left);

const leftForRows = left - JSON.stringify(shortRows).length + 2;
const leftForPairs = left - JSON.stringify(shortPairs).length + 1;
for (const past of [-2_000_000, -1_000_000, -10_000, 1, 10_000, 1_000_000]) {
  console.log("a declared text", past, attempt(() => joinRows(head, parseRows("y".repeat(leftForRows - 1 + past), "c"))));
  console.log("an undeclared text", past, attempt(() => joinRows(head, parseRows("b", "y".repeat(leftForRows - 1 + past)))));
  const half = (leftForRows + past) >> 1;
  console.log("one of each", past, attempt(() => joinRows(head, parseRows("y".repeat(half), "z".repeat(leftForRows + past - half)))));
  console.log("a text of a literal", past, attempt(() => joinPairs(head, [makePair("first", "a"), makePair("second", "y".repeat(leftForPairs + past))])));
  console.log("short texts", joinRows("head", shortRows), joinPairs("head", shortPairs));
}
