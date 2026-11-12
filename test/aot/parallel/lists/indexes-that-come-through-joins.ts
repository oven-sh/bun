const doubles: number[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => k * 1.5 + 0.25).join() + "]");
const integers: number[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => (k * 37) % 101).join() + "]");
const objects: { v: number }[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => `{"v":${k * 3}}`).join() + "]");
const bytes = new Uint8Array(40).map((_, k) => (k * 37) & 255);
const text = "the quick brown fox jumps over the lazy dogs";
const starts: any[] = JSON.parse("[3,1,4,1,5,9,2,6,-1,-2147483648,2147483647,39,40,0.5]");
let last = 0;
function sumLate(list: number[], from: any) {
  let s = 0;
  for (let i = starts[from]; i < 40; i++) {
    let j = i;
    if (j > 20) j = j - 20;
    s = s + (list[j] || 0) + (list[i] || 0);
    last = j;
    if (i < -2) break;
  }
  return s;
}
function nested(list: number[], from: number) {
  let s = 0;
  for (let i = from & 1 ? from : -1; i < 40; i = i & 1 ? i + 3 : i - 1) {
    if (i < -1) i = starts[from & 7];
    for (let j = i; j < i + 3; j++) s = s + (list[j] || 0) * 2;
    let m = i;
    while (m > 30) {
      s = s + (list[m] || 0);
      m -= 9;
    }
    if (s > 5000) break;
  }
  return s;
}
function moved(list: number[], from: any) {
  for (let i = starts[from]; i < 39; i++) {
    const x = list[i];
    if (x === undefined) {
      if (i < 0) break;
      continue;
    }
    list[i] = list[(i + 1) & 31];
    list[(i + 1) & 31] = x;
  }
  return list.length + list[7];
}
function fields(from: any, step: number) {
  let s = 0;
  for (let i = starts[from] | 0, turns = 0; i < 40 && turns < 30; i = (i + step) | 0, turns++) s = s + (objects[i]?.v ?? -1) + (objects[i & 7].v - objects[(i + 1) & 7].v);
  return s;
}
function mixed(from: any) {
  let s = 0;
  for (let i = starts[from]; i < 40; i += 1) {
    if (i < 0) break;
    const c = text.charCodeAt(i);
    s = (s * 31 + c + (bytes[i] ?? 7) + (text[i] === "o" ? bytes[i & 7] : 0)) | 0;
  }
  return s;
}
let line: (number | string)[] = [];
for (let round = 0; round < 4; round++) {
  for (let from = 0; from < starts.length; from++) {
    line.push(sumLate(doubles, from), sumLate(integers, from), last, nested(doubles, from), nested(integers, from), fields(from, (from & 3) - 1), mixed(from), moved(doubles, from), moved(integers, from));
  }
  console.log(line.join(" "));
  line = [];
}
