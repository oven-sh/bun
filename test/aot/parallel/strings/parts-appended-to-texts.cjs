// A part of a string that is appended to a growing text is copied where it lies.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const source = Array.from({ length: 400 }, (_, i) => "part" + i + (i % 5 ? "" : "x".repeat(i % 90))).join(";"), wide = source + "—", flat = JSON.parse(JSON.stringify(source)), flatWide = JSON.parse(JSON.stringify(wide));
const cut = (text, from, to) => text.slice(from, to);
let out = "";
const add = piece => { out += piece; };
const add2 = (first, second) => { out += first + second; };
for (const text of [flat, flatWide, flat]) {
    for (const length of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 200]) {
        out = "";
        const expected = [];
        for (let i = 0; i < 300; ++i) {
            const from = i * 7 % (text.length - length), piece = cut(text, from, from + length);
            add(piece);
            expected.push(piece);
            if (i % 50 === 49) { add2(cut(text, 0, 5), cut(text, 1, 1 + length)); expected.push(text.slice(0, 5), text.slice(1, 1 + length)); }
            if (i % 60 === 59) { const end = out.length, self = cut(out, end - Math.min(end, 12), end); add(self); expected.push(self); add(cut(out, 1, 40)); expected.push(expected.join("").slice(1, 40)); }
            if (i === 150 && globalThis.Bun) Bun.gc(true);
        }
        check("text of " + length, out, expected.join(""));
        check("length of " + length, out.length, expected.join("").length);
    }
}
let first = "", second = "";
for (let i = 0; i < 500; ++i) {
    const piece = cut(flat, i, i + 9);
    first += piece;
    second = first;
    second += "!";
    if (i % 100 === 0) check("two ends " + i, second, first + "!");
    first += cut(piece, 2, 6);
}
check("first", first.length, 500 * 13);
console.log(failures, out.length, second.length);
