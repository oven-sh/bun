// The number of pieces that a split gives, of texts of every length around a vector's.
const pieces = s => s.split("\n").length;
const spaces = s => s.split(" ").length - 1;
const wideSeparator = s => s.split("中").length;
const high = s => s.split("é").length;
const words = s => s.split("ab").length;
const first = s => { const p = s.split(";"); return p[0] + p.length; };
let t = 0;
for (let length = 0; length < 400; length++) {
    const text = "a b;\nx".repeat(70).slice(0, length), late = "x".repeat(length) + "\n", dense = "\n".repeat(length), latin = "éab ".repeat(100).slice(0, length), wide = "中\n a".repeat(100).slice(0, length);
    for (const s of [text, late, dense, latin, wide, text + late])
        t = (t * 31 + pieces(s) + spaces(s) * 3 + wideSeparator(s) * 5 + high(s) * 7 + words(s) * 11 + first(s).length) | 0;
    if (length % 80 === 63) console.log(length, t, pieces(text), pieces(dense), high(latin), wideSeparator(wide), first(text));
}
console.log(t, pieces("\n".repeat(100000)), pieces("x".repeat(70000)), spaces("a ".repeat(30000)));
