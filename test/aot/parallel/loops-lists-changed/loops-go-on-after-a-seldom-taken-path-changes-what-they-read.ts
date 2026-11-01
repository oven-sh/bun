// Loops whose seldom taken path changes what the other iterations read again and again: a field, the storage, length or kind of a list, a variable carried to the next iteration.
type Box = { f: number; list: number[] };
const out: string[] = [];

// `last` holds what the iteration before read. The write comes after that read, so the next iteration still sees the old value.
function carriesAField(box: Box, turns: number, every: number): number {
  let last = box.f;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 3 + last) % 1000003;
    last = box.f;
    if (i % every === every - 1) box.f += i;
  }
  return sum;
}

// The same with the write in front of the read.
function carriesAFieldWrittenFirst(box: Box, turns: number, every: number): number {
  let last = box.f;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i % every === every - 1) box.f += i;
    sum = (sum * 3 + last) % 1000003;
    last = box.f;
  }
  return sum;
}

// The list of the box is replaced now and then. `list` is read from the box at the end of each iteration.
function carriesAList(box: Box, turns: number, every: number): number {
  let list = box.list;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 7 + list[i & 3]! + list.length) % 1000003;
    list = box.list;
    if (i % every === every - 1) box.list = [i, i + 1, i + 2, i + 3, i + 4].slice(0, 4 + (i & 1));
  }
  return sum;
}

// Stores behind the end grow the list in the first iterations, and again much later.
function growsNowAndThen(turns: number): number {
  const kept: number[][] = [];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    kept[i < 5000 ? i & 7 : i & 63] = [i, i + 1];
    sum = (sum + kept[i & 3]![1]! + kept.length) % 1000003;
  }
  return sum;
}

// The kind of storage changes in the middle: integers, then fractions, then strings.
function changesKind(turns: number): string {
  const list: unknown[] = [1, 2, 3, 4];
  let text = "";
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const value = list[i & 3];
    if (typeof value === "number") sum = (sum + value * (i & 15)) % 1000003;
    else text = String(value) + text.length;
    if (i === 1000) list[1] = 0.5;
    if (i === 2000) list[2] = "two";
    if (i === 3000) list.length = 3;
    if (i === 4000) list.push(9, 10);
  }
  return `${sum} ${text} ${list.length}`;
}

// The path is taken in every iteration for a while, then never, then always again.
function takenInRuns(turns: number): number {
  const list: number[] = [];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const phase = (i >> 10) & 3;
    if (phase === 0 || phase === 3) list.push(i);
    else if (list.length > 2) list[i % list.length] = i;
    sum = (sum + list.length + (list[i & 1] ?? -1)) % 1000003;
  }
  return sum;
}

// A variable that takes one of two values in turn, beside a call that allocates. One of the two assignments lies on a path that is guessed to be seldom taken.
const text = (value: number) => (Object.is(value, -0) ? "-0" : String(value));
function alternates(start: number, turns: number): string {
  let a = start;
  let seen = "";
  for (let x = 0; x < turns; x++) {
    a = a === 9 ? 3 : 9;
    seen += text((a + a) >>> 0) + " ";
  }
  return seen + a;
}
function cycles(start: number, turns: number): string {
  let a = start;
  const seen: number[][] = [];
  for (let x = 0; x < turns; x++) {
    a = a === 1 ? 2 : a === 2 ? 4 : 1;
    seen.push([a, x]);
  }
  return seen.map(pair => pair[0]).join("") + a;
}
for (const start of [7, 9, 3, 1, 2]) out.push(`alternates ${start}: ${alternates(start, 7)} | ${cycles(start, 9)}`);

for (const every of [1, 2, 3, 7, 64, 1000, 100000]) {
  out.push(`field ${every}: ${carriesAField({ f: 1, list: [] }, 20000, every)} ${carriesAFieldWrittenFirst({ f: 1, list: [] }, 20000, every)}`);
  out.push(`list ${every}: ${carriesAList({ f: 0, list: [5, 6, 7, 8] }, 20000, every)}`);
}
out.push(`grows: ${growsNowAndThen(20000)}`);
out.push(`kinds: ${changesKind(6000)}`);
out.push(`runs: ${takenInRuns(20000)}`);
console.log(out.join("\n"));
