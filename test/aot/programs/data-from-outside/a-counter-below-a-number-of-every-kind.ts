// A counter that starts at an integer and steps by one, below a bound of type number: every kind of number is the bound once, and the loop uses its counter as an index, for its bits, in a sum and as a value.
const letters = "abcdefghijklmnopqrstuvwxyz";
const table: number[] = [];
for (let i = 0; i < 40; i++) table.push(i * 7);

function bits(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum + (i & 5)) | 0;
    if (i > 50) break;
  }
  return sum;
}
function elements(n: number): string {
  let sum = 0, missing = 0;
  for (let i = 0; i < n; i++) {
    const value = table[i];
    if (value === undefined) missing++;
    else sum += value;
    if (missing > 3) break;
  }
  return sum + "/" + missing;
}
function characters(n: number): string {
  let out = "";
  for (let i = 0; i <= n; i++) {
    out += letters[i % 26];
    if (out.length > 30) break;
  }
  return out;
}
function down(n: number): number {
  let sum = 0;
  for (let i = 10; i > n; i--) {
    sum = (sum ^ (i << 1)) | 0;
    if (i < -40) break;
  }
  return sum;
}
function last(n: number): number {
  let i = 0;
  for (; i < n; i += 3) {
    if ((i & 1023) === 1023 || i > 100) break;
  }
  return i;
}
function nearTheEndOfInt32(n: number): string {
  let seen = "";
  for (let i = 2147483640; i < n; i++) {
    seen += (i | 0) + "," + (i % 7) + ";";
    if (seen.length > 400) break;
  }
  return seen;
}
function changed(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = (sum + (i & 3)) | 0;
    if (i === 4) n = n / 2 + 0.25;
  }
  return sum;
}

const bounds = [0, -0, 1, 7, 7.5, 6.999999, -1, -7.5, 39, 40, 41, 0.1, NaN, Infinity, -Infinity, 2147483646, 2147483647, 2147483648, 2147483650.5, 4294967296, 9007199254740992, 1e300, Number.MIN_VALUE, Number(process.env.NO_SUCH_VARIABLE ?? "12")];
for (const work of [bits, elements, characters, down, last, nearTheEndOfInt32, changed]) {
  const answers: (string | number)[] = [];
  for (const bound of bounds) answers.push(work === changed && !(bound < 100) ? "-" : work(bound));
  console.log(work.name, answers.join(" "));
}
