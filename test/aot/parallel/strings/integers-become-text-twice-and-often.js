// The text of an integer is asked for once, twice and often, by every spelling, in orders that make integers meet in one place of a table, with collections in between, and the texts serve as keys.
const spellings = [n => String(n), n => "" + n, n => `${n}`, n => n.toString(), n => [n].join(), n => String(n + 0.0)];
function digitsOf(n) {
    if (n === 0) return "0";
    let text = "";
    for (let rest = Math.abs(n); rest > 0; rest = Math.floor(rest / 10)) text = "0123456789"[rest % 10] + text;
    return n < 0 ? "-" + text : text;
}
let wrong = 0;
let asked = 0;
function ask(n, spelling) {
    asked++;
    if (spelling(n) !== digitsOf(n)) { wrong++; if (wrong < 5) console.log("wrong", n, spelling(n)); }
}
const edges = [0, 1, 9, 10, 255, 256, 257, 511, 512, 65535, 65536, 65537, 16777216, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296, -1, -255, -256, -257, -2147483648, -2147483649, 9007199254740991];
for (const spelling of spellings) {
    for (let round = 0; round < 4; round++) for (const n of edges) ask(n, spelling);
    for (let n = 0; n < 70000; n += 7) ask(n, spelling);
    for (let round = 0; round < 3; round++) for (let n = 300; n < 300 + 256 * 40; n += 256) ask(n, spelling);
    for (let round = 0; round < 3; round++) { for (let n = 1000; n < 4000; n++) ask(n, spelling); if (round === 1) Bun.gc(true); }
    for (let i = 0; i < 3000; i++) { ask(300 + (i & 1) * 256, spelling); ask(100000 + i, spelling); }
}
const counts = {};
const byText = new Map();
for (let round = 0; round < 3; round++) {
    for (let n = 250; n < 3000; n += 3) {
        const key = spellings[(n + round) % spellings.length](n);
        counts[key] = (counts[key] ?? 0) + 1;
        byText.set(key, (byText.get(key) ?? 0) + n);
    }
    Bun.gc(true);
}
let sum = 0;
for (const key in counts) sum += counts[key] * Number(key);
for (const [key, value] of byText) sum += value - 3 * Number(key);
console.log(asked, wrong, Object.keys(counts).length, byText.size, sum, counts[253], counts["256"], counts[String(2998)]);
