// A character at a position that the turns do not change, beside one that they step: inside, outside, of strings of every making, and of one that a turn replaces.
const T = JSON.parse("30") as number, log: number[] = [], seen: unknown[] = [];
function equal(a: string, b: string, p: number): number { let s = 0; for (let j = 0; j < b.length; j++) { if (a[p] === b[j]) log.push(j); else s += 2; } return s; }
function unequal(a: string, b: string, p: number): number { let s = 0; for (let j = 0; j < b.length; j++) { if (a[p - 1] !== b[j]) { log.push(-j); s++; } } return s; }
function text(a: string, b: string, p: number): number { const marks: string[] = []; for (let j = 0; j < b.length; j++) marks.push(a[p] + b[j]); seen.push(marks.join()); return marks.length; }
function replaced(a: string, b: string, p: number): number { let s = 0; for (let j = 0; j < b.length; j++) { if (a[p] === b[j]) log.push(j); if (j === 2) a = b; s += a === b ? 1 : 0; } return s; }
function missing(a: string, b: string, p: number): number { let s = 0; for (let j = 0; j < b.length; j++) { seen.push(a[p] === undefined); if (a[p] < b[j]) s++; } return s; }
function none(a: string, b: string, p: number): number { let s = 1; for (let j = 5; j < 2; j++) { if (a[p] === b[j]) log.push(j); s++; } return s; }
function common(a: string, b: string): number {
  let previous: number[] = [];
  for (let j = 0; j <= b.length; j++) previous.push(0);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [0];
    for (let j = 1; j <= b.length; j++) current.push(a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]));
    previous = current;
  }
  return previous[b.length];
}
const strings = ["abcabcaab", "abc" + T + "abca", "xxabcabcaabyyxxabcabcaabyy".slice(2, 20), "abācabā", "", "a", "a😀bca", String(T * 7919), "abcab,xbcab".split(",")[1]];
for (let t = 0; t < T; t++) {
  const said: unknown[] = [];
  for (const a of strings) for (const b of strings) {
    const p = [0, 2, -1, 1.5, a.length - 1, a.length, 4294967296][t % 7];
    said.push(equal(a, b, p), unequal(a, b, p), text(a, b, p), replaced(a, b, p), missing(a, b, p), none(a, b, p), common(a, b));
  }
  if (t < 8 || t === T - 1) console.log(said.join(), log.length, log.slice(-30).join(), seen.length, seen.slice(-20).join());
}
