// A short string of two-byte characters that Latin-1 holds changes its case as a Latin-1 string does.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const words = ["color", "COLOR", "Margin-Left", "ÀÉÎ", "àéî", "ß", "straße", "ÿ", "µm", "İstanbul", "ΑΣ", "Āb", "—", "A", "aB", "ABC", "ABCDEFG", "ABCDEFGH", "abcdefgh", "ABCDEFGHIJKLMNO", "ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOPQ", "x".repeat(40) + "Y", "É".repeat(63), "É".repeat(64), "É".repeat(65), "É".repeat(63) + "—", "\u{10400}A", "\ud800B", "12px", "×÷", "ÞÐ"];
const text = words.join(";") + ";—";
const lower = string => string.toLowerCase(), upper = string => string.toUpperCase();
const lowered = words.map(word => Array.from(word, character => character.toLowerCase()).join("")), raised = words.map(word => Array.from(word, character => character.toUpperCase()).join(""));
lowered[words.indexOf("ΑΣ")] = "ας";
for (let round = 0; round < 50; ++round) {
    let start = 0;
    for (let i = 0; i < words.length; ++i) {
        const part = text.slice(start, start + words[i].length);
        start += words[i].length + 1;
        check("lower " + words[i], lower(part), lowered[i]);
        check("upper " + words[i], upper(part), raised[i]);
        check("part " + words[i], part, words[i]);
        check("again " + words[i], lower(upper(part)), lower(raised[i]));
        const flat = (part + "—").slice(0, -1);
        flat.charCodeAt(0);
        check("flat " + words[i], lower(flat) + upper(flat), lowered[i] + raised[i]);
    }
    if (round % 20 === 0 && globalThis.Bun) Bun.gc(true);
}
console.log(failures, words.length);
