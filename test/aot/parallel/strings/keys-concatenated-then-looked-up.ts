// A string key put together on the spot and first used to look something up in a Map or Set. What the parts may be: constants, whole numbers, fractions, strings that are empty, short, long, Latin-1 or 16-bit, undefined and null behind a string type. What the table may be: empty, of a few keys, of hundreds, of tens of thousands. Every answer is checked against the same lookup by a key that was made beforehand.
const report: string[] = [];
let wrong = 0;
function expect(condition: boolean): void {
  if (!condition) wrong++;
}

const pieces: string[] = ["", "x", "left", "neé", "π", "a-piece-of-thirty-two-characters!", "w".repeat(70)];
const numbers: number[] = [0, 7, -7, 1024, 2147483647, -2147483648, 4294967297, 0.25, -0, NaN];

function tally(table: Map<string, number>, head: string, tail: string): number {
  const label = head + ":" + tail;
  const seen = table.get(label);
  table.set(label, seen === undefined ? 1 : seen + 1);
  return seen === undefined ? 0 : seen;
}
function tallyByNumber(table: Map<string, number>, head: string, n: number): number {
  const label = `${head}#${n}`;
  const seen = table.get(label) ?? 0;
  table.set(label, seen + 2);
  return seen;
}
function tallyThreeNumbers(table: Map<string, number>, a: number, b: number, c: number): void {
  const label = a + "." + b + "." + c;
  if (table.has(label)) table.set(label, table.get(label)! * 3);
  else table.set(label, 1);
}
function joinOnce(group: Set<string>, head: string, n: number, tail: string): boolean {
  const label = head + n + tail;
  if (group.has(label)) return false;
  group.add(label);
  return true;
}

{
  const table = new Map<string, number>();
  const plain = new Map<string, number>();
  for (let turn = 0; turn < 3; turn++)
    for (const head of pieces)
      for (const tail of pieces) {
        const made = [head, tail].join(":");
        const before = plain.get(made) ?? 0;
        plain.set(made, before + 1);
        expect(tally(table, head, tail) === before);
      }
  expect(table.size === plain.size);
  for (const [label, times] of plain) expect(table.get(label) === times);
  report.push("two strings " + table.size + " " + [...table.keys()].filter(label => label.length < 8).join("|"));
}
{
  const table = new Map<string, number>();
  const plain = new Map<string, number>();
  for (let turn = 0; turn < 2; turn++)
    for (const head of pieces)
      for (const n of numbers) {
        const made = [head, String(n)].join("#");
        const before = plain.get(made) ?? 0;
        plain.set(made, before + 2);
        expect(tallyByNumber(table, head, n) === before);
      }
  report.push("a string and a number " + table.size + " " + [...table.keys()].slice(0, numbers.length).join("|"));
}
{
  const table = new Map<string, number>();
  for (let a = -2; a < 9; a++) for (let b = 0; b < 40; b += 3) for (let c = 0; c < 2000; c += 999) tallyThreeNumbers(table, a, b, (a * b + c) % 5);
  let product = 0;
  for (const times of table.values()) product += times;
  report.push("three numbers " + table.size + " " + product + " " + [...table.keys()].slice(-3).join("|"));
}
{
  const group = new Set<string>();
  let fresh = 0;
  for (let turn = 0; turn < 2; turn++) for (const head of pieces) for (const n of numbers) for (const tail of ["", "!", "π"]) if (joinOnce(group, head, n, tail)) fresh++;
  report.push("a set " + fresh + " " + group.size);
}

function grownStepByStep(limit: number): string {
  const table = new Map<string, number>();
  let found = 0;
  for (let n = 0; n < limit; n++) {
    const label = "entry " + (n % 2 === 0 ? n : n - 1);
    const held = table.get(label);
    if (held === undefined) table.set(label, n);
    else {
      found++;
      expect(held === n - 1);
    }
  }
  return table.size + " " + found;
}
report.push("sizes " + [1, 2, 9, 10, 300, 600, 70000].map(grownStepByStep).join(" | "));

function behindAType(values: string[], n: number): string {
  const table = new Map<string, number>();
  for (let turn = 0; turn < 2; turn++)
    for (const value of values) {
      const label = value + "/" + n;
      table.set(label, (table.get(label) ?? 0) + 1);
    }
  return [...table].join(" ");
}
report.push(behindAType([undefined, null, "real", undefined] as unknown as string[], 5));

function changedInBetween(): string {
  const table = new Map<string, number>();
  const log: string[] = [];
  for (let n = 0; n < 6; n++) {
    const label = "slot" + (n % 3);
    const first = table.get(label);
    table.delete(label);
    table.set(label, (first ?? 0) + 1);
    const second = table.get(label);
    for (let extra = 0; extra < 30; extra++) table.set("filler" + n + "," + extra, extra);
    table.set(label, (second ?? 0) + 10);
    const third = table.has(label);
    table.clear();
    if (third) table.set(label, n);
    log.push(label + "=" + table.get(label) + "/" + table.size);
  }
  return log.join(" ");
}
report.push(changedInBetween());

function keptAfterwards(table: Map<string, string[]>, family: string, rank: number, member: string): string {
  const label = family + "~" + rank;
  const list = table.get(label);
  if (list === undefined) table.set(label, [member]);
  else list.push(member);
  return label;
}
{
  const table = new Map<string, string[]>();
  const labels: string[] = [];
  for (let n = 0; n < 40; n++) labels.push(keptAfterwards(table, pieces[n % 5]!, n % 3, "m" + n));
  expect(labels.every(label => table.has(label)));
  report.push("lists " + table.size + " " + [...table].map(([label, list]) => label + ":" + list.length).join(" "));
}
report.push("wrong " + wrong);
console.log(report.join("\n"));
