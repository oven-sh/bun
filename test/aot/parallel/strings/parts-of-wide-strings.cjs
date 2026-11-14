// Short parts of a wide string that come again are one string of their own. They are equal to what is cut, whatever holds them.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const words = ["color", "margin-left", "background-color", "été", "a", "", "ab", "ÿÿ", "——x", "\u{1f600}ok", "0", "12", "4294967295", "x".repeat(31), "y".repeat(32), "z".repeat(33), "__proto__", "constructor", "Mixed Case", "\n    ", "Āb"];
const narrow = words.join(";") + ";";
const wide = narrow + "—";
const cut = (text, from, to) => text.slice(from, to);
const starts = [];
for (let at = 0, i = 0; i < words.length; ++i) { starts.push(at); at += words[i].length + 1; }
const table = Object.create(null), map = new Map(), kept = [];
for (let round = 0; round < 60; ++round) {
    for (let i = 0; i < words.length; ++i) {
        const word = words[i], part = cut(wide, starts[i], starts[i] + word.length), other = wide.substring(starts[i], starts[i] + word.length);
        check("part", part, word);
        check("equal", part === word && part === other && !(part < word) && part.length === word.length, true);
        table[part] = (table[part] || 0) + 1;
        map.set(part, (map.get(other) || 0) + 1);
        check("lower", part.toLowerCase(), word.toLowerCase());
        check("joined", "<" + part + other + ">", "<" + word + word + ">");
        check("code", part.charCodeAt(part.length - 1), word.charCodeAt(word.length - 1));
        check("includes", part.includes(word) && wide.includes(part), true);
        check("part of a part", part.slice(1, 4), word.slice(1, 4));
        check("number", +part, +word);
        check("json", JSON.stringify(part), JSON.stringify(word));
        if (round % 10 === 0) kept.push(part);
    }
    if (round % 20 === 0 && globalThis.Bun) Bun.gc(true);
}
for (let i = 0; i < kept.length; ++i) check("kept", kept[i], words[i % words.length]);
const counts = {};
for (const word of words) counts[word] = (counts[word] || 0) + 60;
check("keys", Object.keys(table).sort().join("|"), words.slice().sort().join("|"));
for (const word of words) { check("table " + word, table[word], 60); check("map " + word, map.get(word), 60); }
// Every length and every place, parts of parts too.
let sum = 0;
for (let round = 0; round < 3; ++round)
    for (let from = 0; from < wide.length; from += 3)
        for (let length = 0; length <= 36; ++length) {
            const part = cut(wide, from, from + length), same = cut(narrow, from, Math.min(from + length, narrow.length)) + (from + length > narrow.length ? "—" : "");
            if (part !== same && from + length <= narrow.length) check("any part", part, same);
            const inner = cut(part, 1, length - 1);
            if (from + length <= narrow.length) check("inner part", inner, cut(same, 1, length - 1));
            sum += part.length + inner.length;
        }
console.log(failures, sum, kept.length);
