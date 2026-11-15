// Strings that were just made are converted to lower and upper case: every length up to 70, more of them than the run time remembers, with equal ones in between.
import { Buffer } from "node:buffer";
const alphabets = ["abcXYZ-", "Content-Security-Policy", "aBÀéÿ×÷ß", "x9_"];
let state = 7;
const next = n => (state = (state * 1103515245 + 12345) & 0x7fffffff) % n;
function make(length) { const letters = alphabets[next(alphabets.length)]; let s = ""; for (let i = 0; i < length; i++) s += letters[next(letters.length)]; return s; }
function lowered(s) { let r = ""; for (const c of s) r += c >= "A" && c <= "Z" ? String.fromCharCode(c.charCodeAt(0) + 32) : c === "À" ? "à" : c; return r; }
const base = []; for (let i = 0; i < 400; i++) base.push(make(i % 71));
let wrong = 0, changed = 0, upper = 0; const seen = new Map();
for (let round = 0; round < 6; round++) {
  for (const s of base) {
    const fresh = round & 1 ? Buffer.from(s, "latin1").latin1Slice() : ("_" + s).slice(1), result = fresh.toLowerCase();
    if (result !== lowered(s) || result !== fresh.toLowerCase()) wrong++;
    if (result !== s) changed++;
    seen.set(result, (seen.get(result) ?? 0) + 1); upper += fresh.toUpperCase().length;
  }
  if (round === 2) Bun.gc(true);
}
console.log(wrong, changed, upper, seen.size, Math.max(...seen.values()));
