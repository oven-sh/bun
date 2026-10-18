const heights = new Int32Array([4, -9, 2147483647, 0, -2147483648, 4, 17]);
const depths = new Int16Array([4, 30000, -1, 0]);
const none = new Int32Array(0);

function answers(a: Int32Array, i: number, b: Int16Array, j: number): string {
  const x = a[i]!;
  const y = b[j]!;
  let said = "";
  if (x < y) said += "<";
  if (x > y) said += ">";
  if (x <= y) said += "[";
  if (x >= y) said += "]";
  const asValues = [x < y, x > y, x <= y, x >= y, !(x < y), !(x >= y)];
  return said + " " + asValues.map(answer => (answer ? 1 : 0)).join("");
}

function highestAndWhere(a: Int32Array, turns: number): string {
  let highest = a[0]!;
  let where = -1;
  let lowest = a[turns - 1]!;
  let changes = 0;
  for (let i = 0; i < turns; i++) {
    const now = a[i]!;
    if (now >= highest) {
      highest = now;
      where = i;
    }
    if (now < lowest) {
      lowest = now;
      changes++;
    }
  }
  return highest + " " + where + " " + lowest + " " + changes;
}

function startsUndefined(a: Int32Array): string {
  let most = a[a.length]!;
  let least = a[-1]!;
  let kept = 0;
  for (let i = 0; i < a.length; i++) {
    const now = a[i]!;
    if (now > most) most = now;
    else kept++;
    if (!(now >= least)) least = now;
  }
  return most + " " + least + " " + kept;
}

function ascents(a: Int32Array): number {
  let count = 0;
  for (let i = 0; i <= a.length; i++) {
    if (a[i]! <= a[i + 1]!) count++;
    if (a[i - 1]! > a[i]!) count += 100;
  }
  return count;
}

for (let round = 0; round < 2; round++) {
  const lines: string[] = [];
  for (const i of [0, 1, 2, 4, 7, -1]) for (const j of [0, 1, 2, 4]) lines.push(answers(heights, i, depths, j));
  console.log(lines.join(" | "));
  console.log(highestAndWhere(heights, heights.length), "|", highestAndWhere(heights, heights.length + 2), "|", highestAndWhere(heights, 1), "|", highestAndWhere(none, 0), "|", highestAndWhere(none, 3));
  console.log(startsUndefined(heights), "|", startsUndefined(none), "|", ascents(heights), ascents(none));
}

class Short extends Int32Array {
  get length(): number {
    return 9;
  }
}
const short = new Short([5, 1, 8]);
console.log(startsUndefined(short), "|", ascents(short), "|", highestAndWhere(short, short.length));
