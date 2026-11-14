// A counted loop that data ends early, at every position of a row of iterations: what it has summed, stored and stepped by then, over narrow and wide texts, lists, lists with holes and views.
// STATISTIC: UnrolledLoopsEmitted >= 12
const marks: number[] = [];
function slow(x: number): number { marks.push(x); return x + 1; }
class Scan {
  at = 0;
  seen = 0;
  word(text: string): number { const start = this.at; while (this.at < text.length && text.charCodeAt(this.at) > 32) this.at++; return this.at - start; }
  count(list: number[], end: number): number { for (let i = 0; i < list.length; i++) { if (list[i] === end) return i; this.seen++; } return -1; }
}
function word(text: string, from: number): number { let p = from; while (p < text.length && text.charCodeAt(p) > 32) p++; return p; }
function wordInt(text: string, from: number): number { let p = from; while (p < text.length && text.charCodeAt(p) > 32) p = (p + 1) | 0; return p; }
function hash(text: string): string { let h = 7, p = 0; for (; p < text.length; p++) { const c = text.charCodeAt(p); if (c === 33) break; h = (h * 31 + c) | 0; } return h + ":" + p; }
function total(list: number[], end: number): string { let sum = 0, last = -1, i = 0; for (; i < list.length; i++) { if (list[i] === end) break; sum += list[i]; last = list[i]; } return sum + ":" + last + ":" + i; }
function bytes(list: Uint8Array, end: number): string { let sum = 0, i = 0; while (i < list.length && list[i] !== end) { sum = (sum + list[i]) | 0; i++; } return sum + ":" + i; }
function floats(list: Float64Array, end: number): string { let sum = 0, i = 0; for (; i < list.length; i++) { if (list[i] === end) break; sum += list[i]; } return sum + ":" + i; }
function backwards(list: number[], end: number): string { let sum = 0, i = list.length - 1; for (; i >= 0; i--) { if (list[i] === end) break; sum = (sum * 3 + list[i]) | 0; } return sum + ":" + i; }
function everySecond(list: number[], end: number): string { let n = 0, i = 0; for (; i < list.length; i += 2) { if (list[i] === end) return "found " + i + ":" + n; n++; } return "none " + i + ":" + n; }
function twoEnds(list: number[], a: number, b: number): string { let sum = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (x === a) return "a" + i + ":" + sum; if (x === b) break; sum += x; } return "b:" + sum; }
function unusual(list: number[], end: number): string { let sum = 0, i = 0; for (; i < list.length; i++) { if (list[i] === end) break; if (list[i] % 5 === 0) { sum = (sum + slow(list[i])) | 0; continue; } sum = (sum ^ list[i]) | 0; } return sum + ":" + i; }
function holes(list: (number | undefined)[], end: number): string { let sum = 0, i = 0; for (; i < list.length; i++) { const x = list[i]; if (x === undefined) { sum += 100; continue; } if (x === end) break; sum += x; } return sum + ":" + i; }
function nested(list: number[], end: number): string { let s = ""; for (let k = 0; k < 3; k++) { let i = k; while (i < list.length && list[i] !== end) i++; s += i + ","; } return s; }
function largest(list: number[], end: number): string { let most = -1, i = 0; for (; i < list.length; i++) { const x = list[i]; if (x === end) break; if (x > most) most = x; } return most + ":" + i; }
function stored(list: number[], to: number[], end: number): string { let i = 0; for (; i < list.length; i++) { if (list[i] === end) break; to[i] = list[i] * 2; } return to.join() + ":" + i; }

const answers: string[] = [];
for (const length of [0, 1, 2, 7, 8, 9, 15, 16, 17, 24, 33]) {
  const list: number[] = [], text: string[] = [];
  for (let i = 0; i < length; i++) { list.push(i * 7 % 64 + 1); text.push(String.fromCharCode(65 + i)); }
  const sparse: (number | undefined)[] = list.slice(); delete sparse[3]; delete sparse[11];
  for (const at of [-1, 0, 1, 2, 5, 6, 7, 8, 9, 10, 15, 16, 22, 31]) {
    const end = at >= 0 && at < length ? list[at] : -5;
    const narrow = text.map((c, i) => i === at ? " " : c).join(""), wide = text.map((c, i) => i === at ? " " : i === 4 ? "€" : c).join(""), bang = narrow.replace(" ", "!");
    const scan = new Scan(); scan.at = length > 2 ? 1 : 0;
    answers.push([word(narrow, 0), word(wide, 0), word(narrow, 3), wordInt(narrow, 0), wordInt(wide, 1), hash(bang), hash(wide), total(list, end), bytes(new Uint8Array(list), end), floats(new Float64Array(list), end), backwards(list, end), everySecond(list, end), twoEnds(list, end, length > 4 ? list[4] : 0), twoEnds(list, length > 9 ? list[9] : 0, end), unusual(list, end), holes(sparse, end), nested(list, end), largest(list, end), stored(list, [], end), scan.word(narrow), scan.at, scan.count(list, end), scan.seen].join("|"));
  }
}
let sum = 0;
for (const answer of answers) { for (let i = 0; i < answer.length; i++) sum = (sum * 31 + answer.charCodeAt(i)) | 0; }
console.log(answers.length, sum, marks.length);
for (let i = 0; i < answers.length; i += 11) console.log(answers[i]);
