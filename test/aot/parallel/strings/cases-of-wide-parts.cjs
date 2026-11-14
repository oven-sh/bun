// The lower and the upper case of short parts of a string with two-byte characters, of every length and with a letter of the other case at every place.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const lower = string => string.toLowerCase(), upper = string => string.toUpperCase();
const isImportant = string => string.toLowerCase() === "!important";
const kind = string => { switch (string.toLowerCase()) { case "color": return 1; case "!important": return 2; case "a": return 3; default: return 0; } };
const characters = ["@", "A", "M", "Z", "[", "`", "a", "m", "z", "{", "-", "0", " ", "\x7f", "\x80", "\xc0", "\xd7", "\xdf", "\xe9", "\xff", "Ā", "İ", "Ł", "š", "ſ", "K", "䅡", "慁", "\ud801", "Ａ"];
const parts = [];
for (let length = 1; length <= 70; ++length) {
    for (const filler of ["x", "X", "-"])
        parts.push(filler.repeat(length));
    for (let place = 0; place < length; place += length > 12 ? 5 : 1)
        for (const character of characters)
            parts.push("y".repeat(place) + character + "-".repeat(length - place - 1));
}
parts.push("color", "Color", "!important", "!IMPORTANT", "!Important", "!İmportant", "a", "A");
const each = (part, convert) => { let converted = ""; for (let i = 0; i < part.length; ++i) converted += convert(part[i]); return converted; };
const table = {}, map = new Map();
for (let round = 0; round < 3; ++round) {
    const text = "名" + parts.join("名") + "名";
    let start = 1;
    for (const part of parts) {
        const slice = () => text.slice(start, start + part.length);
        const lowered = each(part, c => c.toLowerCase()), raised = each(part, c => c.toUpperCase());
        check("lower " + part, lower(slice()), lowered);
        check("upper " + part, upper(slice()), raised);
        const kept = slice();
        check("same " + part, lower(kept) === kept, lowered === part);
        check("then " + part, lower(upper(kept)), each(raised, c => c.toLowerCase()));
        check("joined " + part, "on-" + lower(kept) + upper(kept), "on-" + lowered + raised);
        check("important " + part, isImportant(slice()), lowered === "!important");
        check("kind " + part, kind(slice()), lowered === "color" ? 1 : lowered === "!important" ? 2 : lowered === "a" ? 3 : 0);
        table[lower(slice())] = lowered;
        check("named " + part, table[lowered], lowered);
        map.set(lower(slice()), part.length);
        check("entry " + part, map.get(lowered), part.length);
        start += part.length + 1;
    }
    if (globalThis.Bun) Bun.gc(true);
}
console.log(failures, parts.length, map.size);
