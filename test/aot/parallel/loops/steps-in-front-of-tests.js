// Loops whose test steps the number it asks (while (i--), i-- > 0, i++ < n): starts of every kind, lists of every kind.
// STATISTIC: StepsRedefinedAfterTests >= 30
function whileDown(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i--) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function whileLength(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i--) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function forDown(a, n) {
  let s = 0, turns = 0;
  for (let i = n; i--;) { s += a[i]; if (++turns > 40) break; } return [s, turns];
}
function forLength(a, n) {
  let s = 0, turns = 0;
  for (let i = a.length; i--;) s += a[i]; return [s, 0];
}
function aboveZero(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i-- > 0) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function lengthAboveZero(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i-- > 0) s += a[i]; return [s, i];
}
function fromOne(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i-- >= 1) s += a[i]; return [s, i];
}
function zeroBelow(a, n) {
  let s = 0, turns = 0;
  let i = n; while (0 < i--) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function belowLength(a, n) {
  let s = 0, turns = 0;
  let i = 0; while (i++ < a.length) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function belowNumber(a, n) {
  let s = 0, turns = 0;
  let i = -1; while (i++ < n) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function upFromNumber(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i++ < 9) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function upTo(a, n) {
  let s = 0, turns = 0;
  let i = 0; while (i++ <= a.length) { s += a[i - 1]; if (++turns > 40) break; } return [s, i];
}
function stepped(a, n) {
  let s = 0, turns = 0;
  let i = n; while (--i) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function doDown(a, n) {
  let s = 0, turns = 0;
  let i = n; do { s += a[i]; if (++turns > 40) break; } while (i--); return [s, i];
}
function both(a, n) {
  let s = 0, turns = 0;
  let i = n, j = 5; while (i-- && j--) { s += a[i] + j; if (++turns > 40) break; } return [s, i, j];
}
function either(a, n) {
  let s = 0, turns = 0;
  let i = n, j = 3; while (i-- > 2 || j-- > 0) { s += a[j < 0 ? 0 : j] + i; if (++turns > 40) break; } return [s, i, j];
}
function notZero(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i-- !== 0) { s += a[i]; if (++turns > 40) break; } return [s, i];
}
function amid(a, n) {
  let s = 0, turns = 0;
  let i = n; for (let k = 0; k < 6; k++) if (i--) s += a[i]; else s += 100; return [s, i];
}
function asked(a, n) {
  let s = 0, turns = 0;
  let i = n; for (;;) { if (!i--) break; s += a[i]; if (++turns > 40) break; } return [s, i];
}
function stores(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i--) a[i] = i * 2; return [a[0], i];
}
function storesOther(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i-- > 0) { if (i < 50) a[i] = i; if (++turns > 40) break; } return [a[0], i];
}
function moves(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (--i > 0) a[i] = a[i - 1]; return [a[0], i];
}
function shrinks(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i--) { s += a[i]; if (i === 4) a.length = 2; } return [s, i];
}
function grows(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i--) { s += a[i]; if (i === 4 && a.length < 20) a.push(7); } return [s, i];
}
function pops(a, n) {
  let s = 0, turns = 0;
  let i = a.length; while (i-- > 0) { s += a[i]; a.pop(); if (++turns > 40) break; } return [s, i];
}
function nested(a, n) {
  let s = 0, turns = 0;
  let i = 4; while (i--) { let j = n; while (j--) { s += a[j] + i; if (++turns > 60) return [s, i, j]; } } return [s, i];
}
function kept(a, n) {
  let s = 0, turns = 0;
  let i = n, last; while (i--) { last = i; s += last; if (++turns > 40) break; } return [s, i, last];
}
function before(a, n) {
  let s = 0, turns = 0;
  let i = n, k; while (k = i--) { s += a[i] + k; if (++turns > 40) break; } return [s, i, k];
}
function text(a, n) {
  let s = 0, turns = 0;
  let i = a.length, said = ""; while (i--) said += i + ","; return [said, i];
}
function returned(a, n) {
  let s = 0, turns = 0;
  let i = n; while (i--) if (a[i] === 3 || ++turns > 40) return [i, s]; return [s, i];
}
function shifted(a, n) {
  let s = 0, turns = 0;
  let i = n | 0; while (i--) { s += a[i >> 1] + (i & 3); if (++turns > 40) break; } return [s, i];
}
let seen = 0;
const log = [];
const word = (value) => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : String(value));
const starts = {
  "0": () => 0,
  "1": () => 1,
  "5": () => 5,
  "9": () => 9,
  "12": () => 12,
  "-1": () => -1,
  "-5": () => -5,
  "half": () => 2.5,
  "minus half": () => -0.5,
  "minus zero": () => -0,
  "not a number": () => NaN,
  "far": () => 2147483648,
  "farthest": () => 9007199254740992,
  "low": () => -2147483648,
  "endless": () => Infinity,
  "text": () => "5",
  "word": () => "a",
  "empty": () => "",
  "big": () => 5n,
  "none": () => undefined,
  "nothing": () => null,
  "true": () => true,
  "counting": () => ({ valueOf() { seen++; return 4; } }),
  "throwing": () => ({ valueOf() { throw new TypeError("t"); } }),
  "symbol": () => Symbol.iterator,
  "list": () => [3],
};
const lists = {
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  "ints": () => [1, 2, 3, 4, 5, 6, 7, 8],
  "texts": () => ["a", "b", "c", "d", "e", "f"],
  "mixed": () => [1, "2", null, 4.5, undefined, true, 7, 8],
  "holes": () => [1, , 3, , 5, 6, 7],
  "view": () => new Float64Array([0.5, 1, 2, 3, 4, 5]),
  "bytes": () => new Uint8Array([1, 2, 3, 4, 5, 6]),
  "empty": () => [],
  "one": () => [4],
  "objects": () => [{ valueOf() { seen++; return 2; } }, 3, 4, 5, 6, 7],
};
const functions = { whileDown, whileLength, forDown, forLength, aboveZero, lengthAboveZero, fromOne, zeroBelow, belowLength, belowNumber, upFromNumber, upTo, stepped, doDown, both, either, notZero, amid, asked, stores, storesOther, moves, shrinks, grows, pops, nested, kept, before, text, returned, shifted };
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const list of Object.keys(lists)) {
    for (const start of Object.keys(starts)) {
      for (const name of Object.keys(functions)) {
        if (numberOfCase++ % 5) continue;
        const a = lists[list](), n = starts[start]();
        seen = 0;
        let answer;
        try {
          answer = functions[name](a, n).map(word).join(" ");
        } catch (error) {
          answer = error.name;
        }
        log.push(name + " " + list + " " + start + ": " + answer + " | " + Array.from(a, word).slice(0, 14).join() + " " + seen);
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
