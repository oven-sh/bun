// A sum of strings and integers is written into one flat string where a part is a short rope too, and a short rope is resolved by writing its parts from the last to the first.
// COUNTER: RopesJoinedWithIntegers >= 30
const log = [];
const id = v => [v][0];
const day = n => ["Sun", "Monday", "T", "", "Wednesday of the week", "жб"][n % 6];
function line(a, b, c, d) { return id(day)(a) + ", " + id(day)(b) + " " + c + ":" + d + " end"; }
function stamp(a, c, d) { const s = id(day)(a) + id(day)(a + 1); return `${s}/${c | 0}/${d | 0}`; }
function nested(a, n) { let s = id(day)(a) + "-"; for (let i = 0; i < n; i++) s = s + i + (id(day)(i) + ";"); return s; }
function right(a, n) { let s = id("e"); for (let i = 0; i < n; i++) s = (id(day)(i) + i) + s; return s; }
function pieces(a, c, d) { const s = (id("some longer text ") + a).slice(3, 14), t = s.slice(1, 5) + id("|") + s; return t + (c | 0) + "." + (d | 0) + t; }
const read = s => [s.charCodeAt(0), s.charCodeAt(s.length >> 1), s.length, s === id(s) + "", { [s]: 1 }[s], s].join();
for (let i = 0; i < 40; i++) {
    const c = [0, 7, -3, 255, 256, 2007, 1e9 | 0, -(2 ** 31)][i % 8], d = i * 37;
    const a = line(i, i + 1, c, d), b = stamp(i, c, d), e = nested(i, i % 12), f = right(i, i % 40), g = pieces(i, c, d);
    log.push(read(a), read(b), read(e), read(f), read(g), read(a + b), read(e + (f + g)), read(b + c + (a + d)));
}
log.push(read(nested(1, 400)).length, read(right(2, 300)).length, (id("x".repeat(600)) + (id("y") + "z")).charCodeAt(601), read(id("ab") + id("ж") + 5 + 6));
console.log(log.join("\n"));
