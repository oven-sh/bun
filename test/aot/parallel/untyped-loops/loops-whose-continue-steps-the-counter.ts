// A `continue` that steps the counter itself is a second way back to the top of the loop. However often it is taken, and whatever it steps by, the loop visits what plain Bun visits.
const log: string[] = [];

function skipBlanks(text: string): number {
  let sum = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9) {
      i++;
      continue;
    }
    sum += c;
    i++;
  }
  return sum;
}

function skipThrees(list: Int32Array): number {
  let sum = 0;
  let k = 0;
  while (k < list.length) {
    const x = list[k];
    if (x === 3) {
      k++;
      continue;
    }
    sum += x;
    k++;
  }
  return sum;
}

function stepsByTwoInTheArm(list: number[]): string {
  let sum = 0;
  let visits = 0;
  let k = 0;
  while (k < list.length) {
    visits++;
    const x = list[k];
    if (x % 5 === 0) {
      k += 2;
      continue;
    }
    sum += x;
    k++;
  }
  return sum + " " + visits + " " + k;
}

function armDoesNotStep(list: number[]): string {
  let again = true;
  let visits = 0;
  let k = 0;
  while (k < list.length) {
    visits++;
    if (list[k] === 4 && again) {
      again = false;
      continue;
    }
    again = true;
    k++;
  }
  return visits + " " + k;
}

function countsDown(list: Float64Array): string {
  let sum = 0;
  let k = list.length - 1;
  while (k >= 0) {
    const x = list[k];
    if (x < 0) {
      k--;
      continue;
    }
    sum += x;
    k--;
  }
  return sum + " " + k;
}

function armStepsBack(list: number[]): string {
  let budget = 5;
  let visits = 0;
  let k = 0;
  while (k < list.length) {
    visits++;
    if (list[k] === 2 && budget > 0 && k > 0) {
      budget--;
      k--;
      continue;
    }
    k++;
  }
  return visits + " " + k + " " + budget;
}

function boundMovesInTheArm(list: number[]): string {
  let sum = 0;
  let k = 0;
  while (k < list.length) {
    const x = list[k];
    if (x === 7 && list.length < 40) {
      list.push(1);
      k++;
      continue;
    }
    sum += x;
    k++;
  }
  return sum + " " + k + " " + list.length;
}

function pastInt32(start: number, turns: number): string {
  let odd = 0;
  let i = start;
  const end = start + turns;
  while (i < end) {
    if (i % 3 === 0) {
      i++;
      continue;
    }
    odd += i % 2;
    i++;
  }
  return odd + " " + i;
}

function labelled(rows: number[][]): string {
  let sum = 0;
  let r = 0;
  outer: while (r < rows.length) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] < 0) {
        r++;
        continue outer;
      }
      if (row[c] === 0) {
        c++;
        continue;
      }
      sum += row[c];
      c++;
    }
    r++;
  }
  return sum + " " + r;
}

function threeArms(text: string): string {
  let digits = 0, letters = 0, others = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) { digits++; i++; continue; }
    if (c >= 97 && c <= 122) { letters++; i++; continue; }
    others++;
    i++;
  }
  return digits + " " + letters + " " + others + " " + i;
}

function leavesFromTheArm(list: number[], stop: number): string {
  let sum = 0;
  let k = 0;
  while (k < list.length) {
    const x = list[k];
    if (x === stop) {
      k++;
      if (sum > 50) break;
      continue;
    }
    sum += x;
    k++;
  }
  return sum + " " + k;
}

for (const text of ["", " ", "a", "ab \tcd", " \t \t", "abcdefgh", "abcdefgh ", "ab \tcd".repeat(9), "x".repeat(33) + " ", "é \tü", "a" + String(log.length) + " b".repeat(7)])
  log.push("skipBlanks " + skipBlanks(text) + " | threeArms " + threeArms(text));
for (const length of [0, 1, 2, 7, 8, 9, 15, 16, 17, 64, 67]) {
  const ints = new Int32Array(length);
  const floats = new Float64Array(length);
  const list: number[] = [];
  for (let i = 0; i < length; i++) {
    ints[i] = i % 7;
    floats[i] = i % 4 === 1 ? -i : i + 0.5;
    list.push(i % 9);
  }
  log.push(length + ": " + [skipThrees(ints), stepsByTwoInTheArm(list), armDoesNotStep(list), countsDown(floats), armStepsBack(list), leavesFromTheArm(list, 3), boundMovesInTheArm(list)].join(" | "));
}
log.push("all threes " + skipThrees(new Int32Array(20).fill(3)) + " | none " + skipThrees(new Int32Array(20).fill(2)));
for (const start of [0, 2147483640, 2147483647, 4294967290, -2147483650, -5]) log.push("pastInt32 " + pastInt32(start, 20));
log.push("labelled " + labelled([[1, 0, 2], [3, -1, 100], [], [0, 0], [4, 5, 0, 6], [-1]]));
console.log(log.join("\n"));
