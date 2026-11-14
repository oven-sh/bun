// A product of two numbers that are never negative lies within the product of their bounds, and a bit operator over a bounded fraction within the bounds of the fraction. -0, NaN, 2 ** 31 and 2 ** 53 stay what they are.
let state = 12345;
const rand = () => { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return state / 0x80000000; };
const show = value => Object.is(value, -0) ? "-0" : String(value);
const pool = [0, -0, NaN, 0.5, -0.5, 1, -1, 0.999999999, Infinity, -Infinity, 2147483647.5, -2147483648.5, 1e300, 5e-324, 3];
function shuffled(n) { const list = Array.from({ length: n }, (_, i) => i); for (let index = n; index !== 0;) { const at = Math.floor(Math.random() * index); index--; const held = list[index]; list[index] = list[at]; list[at] = held; } return list; }
function shuffledBySeed(n) { const list = Array.from({ length: n }, (_, i) => "c" + i); for (let index = n; index !== 0;) { const at = (rand() * index) | 0; index--; [list[index], list[at]] = [list[at], list[index]]; } return list; }
function clamped(value, n) { const part = Math.min(1, Math.max(0, value)); return [part * n, (part * n) | 0, ~~(part * n), (part * n) >>> 0, Math.floor(part * n), part * -n, -part * n, part * 0, part * -0].map(show).join(); }
function signed(value, n) { const part = Math.max(-1, Math.min(1, value)); return [part * n, part * part, (part * n) | 0, (part * n) >>> 0, (part * 4) >> 1, (part * 4) & 255, (part * 4) ^ -1, ~(part * 4)].map(show).join(); }
function wide(value) { const part = Math.max(0, Math.min(3000000000, value)); return [part * 2, (part * 2) | 0, part >>> 1, part | 0, part * 3000000000, (part * 3000000000) | 0].map(show).join(); }
function inside(n) { const bytes = new Uint8Array(8), text = "abcdefgh"; let out = ""; for (let i = 0; i < n; i++) { const at = (rand() * 8) | 0; bytes[at] += (rand() * 300) | 0; out += text[at] + text[Math.floor(rand() * 9)] + (at < 8) + (at >= 0); } return out + bytes.join(); }
function counted(n) { const list = [1, 2, 3, 4, 5]; let sum = 0; for (let i = 0; i < n; i++) { const at = Math.floor((i & 7) / 8 * list.length); sum += list[at]; const past = Math.floor((i & 7) / 4 * list.length); sum += list[past] ?? 100; } return sum; }
const lines = [];
for (let round = 0; round < 40; round++) {
  const list = shuffled(52);
  lines.push(list.length, list.slice().sort((a, b) => a - b).every((value, at) => value === at), shuffledBySeed(20).join(""), inside(30), counted(50));
  for (const value of pool) lines.push(clamped(value, round), signed(value, round), wide(value));
}
let hash = 0; for (const line of lines) for (const character of String(line)) hash = (Math.imul(hash, 31) + character.codePointAt(0)) | 0;
console.log(lines.length, hash, lines.slice(0, 6).join(" "), lines.slice(-3).join(" "));
