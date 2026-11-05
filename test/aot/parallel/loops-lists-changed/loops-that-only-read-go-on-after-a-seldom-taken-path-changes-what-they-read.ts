// Loops that allocate nothing on their usual path. A path that is seldom taken changes what every other iteration reads: a field, a list's storage, length or kind,
// the shape of an object, the counter itself. The iterations behind it must see the change, however often the path is taken and wherever in the iteration it lies.
type Box = { f: number; list: number[] };
const out: string[] = [];

function replace(box: Box, i: number) {
  box.list = [i, i + 1, i + 2, i + 3];
  box.f = i;
}
function grow(list: number[], i: number) {
  for (let k = 0; k < 9; k++) list.push(i + k);
}

// Kept numbers go into a list that grows now and then.
function keepsSome(from: number[]): number {
  const kept: number[] = [];
  for (let k = 0; k < from.length; k++) {
    const value = from[k]!;
    if (value > 0) kept.push(value);
  }
  let sum = kept.length;
  for (let k = 0; k < kept.length; k++) sum = (sum * 31 + kept[k]!) % 1000003;
  return sum;
}

// The field and the list of the box are replaced by a call.
function readsABox(box: Box, turns: number, every: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 3 + box.f + box.list[i & 3]! + box.list.length) % 1000003;
    if (i % every === every - 1) replace(box, i);
  }
  return sum;
}

// The same with the call in front of the reads.
function readsABoxChangedFirst(box: Box, turns: number, every: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i % every === every - 1) replace(box, i);
    sum = (sum * 3 + box.f + box.list[i & 3]! + box.list.length) % 1000003;
  }
  return sum;
}

// What one iteration has read is used by the next.
function carriesWhatItRead(box: Box, turns: number, every: number): number {
  let last = box.f;
  let list = box.list;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 5 + last + list[i & 3]!) % 1000003;
    last = box.f;
    list = box.list;
    if (i % every === every - 1) replace(box, i);
  }
  return sum;
}

// The list that is walked grows while it is walked.
function walksAListThatGrows(limit: number): number {
  const list = [1, 2, 3];
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum = (sum * 7 + list[i]!) % 1000003;
    if (list.length < limit && (i & 63) === 2) grow(list, i);
  }
  return sum + list.length;
}

// Nothing is set up until the first iteration has run.
let table: number[] | undefined;
function setsUpInTheFirstIteration(turns: number): number {
  table = undefined;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (table === undefined) table = [3, 5, 7, 11];
    sum = (sum * 3 + table[i & 3]!) % 1000003;
  }
  return sum;
}

// The path is taken in every iteration for a while, then never, then in every other one.
function takenInRuns(box: Box, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const phase = (i >> 8) & 3;
    if (phase === 0 || (phase === 2 && (i & 1) === 1)) replace(box, i);
    sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
  }
  return sum;
}

// The counter goes down, or by more than one, and the seldom taken path moves it too.
function countsDown(box: Box, turns: number, every: number): number {
  let sum = 0;
  for (let i = turns; i > 0; i--) {
    sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
    if (i % every === 0) replace(box, i);
  }
  return sum;
}
function countsByThree(box: Box, turns: number, every: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i += 3) {
    sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
    if (i % every === 0) {
      replace(box, i);
      i += 2;
    }
  }
  return sum;
}
function goesBack(box: Box, turns: number): number {
  let sum = 0;
  let left = 40;
  for (let i = 0; i < turns; i++) {
    sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
    if ((i & 127) === 100 && left-- > 0) {
      replace(box, i + left);
      i -= 2;
    }
  }
  return sum;
}

// The kind of storage and the shape change in the middle.
function changesKind(turns: number): string {
  const list: unknown[] = [1, 2, 3, 4];
  const point: Record<string, number> = { x: 1, y: 2 };
  let sum = 0;
  let text = "";
  for (let i = 0; i < turns; i++) {
    const value = list[i & 3];
    if (typeof value === "number") sum = (sum + value * (i & 15) + point.x! + point.y!) % 1000003;
    else text = String(value) + text.length;
    if (i === 1000) list[1] = 0.5;
    if (i === 1001) list[2] = "two";
    if (i === 2000) point.z = 9;
    if (i === 3000) delete point.x, (point.x = 40);
    if (i === 4000) list.length = 3;
  }
  return `${sum} ${text} ${list.length} ${Object.keys(point)}`;
}

// The path throws, and the loop goes on behind the catch.
function catches(box: Box, turns: number, every: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    try {
      if (i % every === every - 1) {
        replace(box, i);
        throw new RangeError("seldom");
      }
      sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
    } catch (error) {
      sum = (sum + (error as Error).message.length + box.f) % 1000003;
    }
  }
  return sum;
}

// The path ends the loop, or skips the rest of the iteration.
function leavesOrSkips(box: Box, turns: number, every: number, end: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === end) break;
    if (i % every === every - 1) {
      replace(box, i);
      continue;
    }
    sum = (sum * 3 + box.f + box.list[i & 3]!) % 1000003;
  }
  return sum;
}

// A short loop inside, entered again and again, whose first iteration takes the path.
function shortLoops(rounds: number): number {
  const from = [4, 5, 6];
  let sum = 0;
  for (let r = 0; r < rounds; r++) {
    const list = [r & 7];
    for (let k = 0; k < from.length; k++) list.push(from[k]!);
    sum = (sum + list.length + list[2]! + list[0]!) % 1000003;
  }
  return sum;
}

const numbers: number[] = [];
for (let k = 0; k < 3000; k++) numbers.push(k / 3 - 300);
const fresh = (): Box => ({ f: 1, list: [1, 2, 3, 4] });
out.push(`keepsSome ${keepsSome(numbers)} ${keepsSome([])} ${keepsSome([1])} ${keepsSome([-1, 2, -3, 4, 5])}`);
for (const every of [1, 2, 3, 7, 64, 1000, 100000]) {
  out.push(
    `every ${every}: ${readsABox(fresh(), 5000, every)} ${readsABoxChangedFirst(fresh(), 5000, every)} ${carriesWhatItRead(fresh(), 5000, every)}` +
      ` ${countsDown(fresh(), 5000, every)} ${countsByThree(fresh(), 5000, every)} ${catches(fresh(), 5000, every)} ${leavesOrSkips(fresh(), 5000, every, 4321)}`,
  );
}
for (const turns of [0, 1, 2, 3, 4, 5]) out.push(`turns ${turns}: ${readsABox(fresh(), turns, 1)} ${readsABox(fresh(), turns, 2)} ${carriesWhatItRead(fresh(), turns, 2)} ${setsUpInTheFirstIteration(turns)}`);
out.push(`walksAListThatGrows ${walksAListThatGrows(5000)} ${walksAListThatGrows(3)}`);
out.push(`setsUpInTheFirstIteration ${setsUpInTheFirstIteration(5000)}`);
out.push(`takenInRuns ${takenInRuns(fresh(), 6000)}`);
out.push(`goesBack ${goesBack(fresh(), 6000)}`);
out.push(`changesKind ${changesKind(5000)}`);
out.push(`shortLoops ${shortLoops(5000)}`);
console.log(out.join("\n"));
