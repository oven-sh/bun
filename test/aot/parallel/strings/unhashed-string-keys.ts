// Flat strings that have no cached hash yet (from JSON.parse, join, toLowerCase, fromCharCode, padEnd, replace) used as Map and Set keys, at every length from 0 to 40.
class Sym { constructor(public name: string, public id: number) {} }
const out: string[] = [];
function say(what: string, ...parts: unknown[]): void { out.push(what + ": " + parts.join(" ")); }
const letters = "abcdefghijklmnopqrstuvwxyz0123456789_$-./:;éüÿ";
function text(length: number, seed: number): string { let t = ""; for (let i = 0; i < length; i++) t += letters[(seed * 31 + i * 7 + (seed >> 3)) % letters.length]; return t; }
const ways: [string, (s: string) => string][] = [
    ["parse", s => JSON.parse(JSON.stringify(s)) as string],
    ["parsed list", s => (JSON.parse(JSON.stringify([s, s])) as string[])[1]],
    ["join", s => s.split("").join("")],
    ["lower", s => s.toUpperCase().toLowerCase()],
    ["codes", s => String.fromCharCode(...s.split("").map(c => c.charCodeAt(0)))],
    ["replace", s => ("#" + s).replace("#", "")],
    ["pad", s => s.length ? s.slice(0, -1).padEnd(s.length, s[s.length - 1]) : s],
    ["repeat", s => s.repeat(1) + "".repeat(3)],
    ["array", s => [s].toString()],
    ["normalize", s => (s + "x").normalize().slice(0, -1).split("").join("")],
];
let wrong = 0;
let checksum = 0;
for (let length = 0; length <= 40; length++) {
    const m = new Map<string, Sym>();
    const s = new Set<string>();
    const model: Record<string, number> = Object.create(null);
    for (let seed = 0; seed < 24; seed++) {
        const original = text(length, seed);
        const [, make] = ways[seed % ways.length];
        switch (seed % 4) {
        case 0: m.set(original, new Sym(original, seed)); s.add(original); break;
        case 1: m.set(make(original), new Sym(original, seed)); s.add(make(original)); break;
        case 2: m.set(make(original), new Sym(original, -1)); m.set(make(original), new Sym(original, seed)); s.add(make(original)); s.add(make(original)); break;
        default: continue;
        }
        model[original] = seed;
    }
    for (let seed = 0; seed < 24; seed++) {
        const original = text(length, seed);
        for (const [, make] of ways) {
            const expected = model[original];
            const found = m.get(make(original));
            if ((found ? found.id : undefined) !== expected) wrong++;
            if (m.has(make(original)) !== (expected !== undefined)) wrong++;
            if (s.has(make(original)) !== (expected !== undefined)) wrong++;
            if (found) checksum = (checksum * 31 + found.id + length) | 0;
        }
    }
    let count = 0;
    for (const k in model) { count++; if (!m.delete(ways[count % ways.length][1](k))) wrong++; if (!s.delete(ways[(count + 3) % ways.length][1](k))) wrong++; if (m.has(k) || s.has(k)) wrong++; }
    if (m.size || s.size) wrong++;
}
say("every length and way", "wrong", wrong, "checksum", checksum);
{
    const wide = ["日本語", "ключ", "éā", "a b", "𝒳y"];
    const m = new Map<string, number>();
    wide.forEach((k, i) => m.set(k.split("").join(""), i));
    say("16 bits", wide.map(k => m.get(JSON.parse(JSON.stringify(k)) as string)).join(" "), m.get("日本"), m.size);
    const narrow = "café";
    const asWide = (narrow + "ā").slice(0, -1).split("").join("");
    m.set(narrow.split("").join(""), 10);
    say("the same text in both widths", m.get(asWide), m.get(JSON.parse('"caf\\u00e9"') as string), m.has((asWide + "ā").slice(0, 4)));
}
{
    const m = new Map<string, number>();
    const names = JSON.parse('["content-type","content-length","accept","host","x-a","x-b","x-c","x-d","x-e","x-f","x-g","x-h","x-i","x-j","x-k","x-l","x-m"]') as string[];
    names.forEach((n, i) => m.set(n, i));
    const asked = JSON.parse('["Content-Type","HOST","X-M","x-z","ACCEPT",""]') as string[];
    say("headers", asked.map(n => m.get(n.toLowerCase())).join(" "), [...m.keys()].join(",").length);
    const same = JSON.parse('["k","k","k"]') as string[];
    const counts = new Map<string, number>();
    for (const k of same) counts.set(k, (counts.get(k) ?? 0) + 1);
    say("counted", counts.get("k"), counts.size);
}
{
    const anyMap: Map<any, any> = new Map<string, number>();
    const fresh = (s: string) => s.split("").join("");
    anyMap.set(fresh("one"), 1); anyMap.set(1, "number"); anyMap.set(fresh("two"), 2);
    say("beside other keys", anyMap.get(fresh("one")), anyMap.get(fresh("two")), anyMap.get(1), anyMap.get(fresh("1")), anyMap.size);
    const o: Record<string, number> = {};
    const key = fresh("shared");
    const m = new Map<string, number>([[key, 1]]);
    o[key] = 2;
    say("also a property name", m.get(fresh("shared")), o[fresh("shared")], m.get(Object.keys(o)[0]));
}
{
    let total = 0;
    const m = new Map<string, number>();
    for (let round = 0; round < 400; round++) {
        const list = JSON.parse(JSON.stringify(Array.from({ length: 20 }, (_, i) => "id" + ((round * 7 + i * 13) % 97)))) as string[];
        for (const k of list) { const before = m.get(k); m.set(k, (before ?? 0) + 1); total += before ?? 0; }
    }
    say("many", total, m.size);
}
console.log(out.join("\n"));
