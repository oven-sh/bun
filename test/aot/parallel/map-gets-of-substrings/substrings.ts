// Substrings as keys of Map.get: absent ones, found ones, ones that are set afterwards, long ones, 16-bit ones, empty maps, wide keys and tables in the image.
const words = "the quick brown fox jumps over the lazy dog and the keyword of another identifier is a very long name that has more than forty eight characters in it indeed_it_does_have_many_more_than_forty_eight_characters_of_name äöü naïve 日本語 日本 keyword";
function split(text: string): string[] { const out: string[] = []; let start = 0; for (let i = 0; i <= text.length; i++) if (i === text.length || text.charCodeAt(i) === 32) { out.push(text.substring(start, i)); start = i + 1; } return out; }
const keywords = new Map<string, number>(Object.entries({ the: 1, and: 2, of: 3, is: 4, has: 5, "日本": 6, keyword: 7 }));
const constant = new Map([["fox", 1.5], ["dog", 2.5], ["in", NaN], ["naïve", -0]]);
const mixed = new Map<any, any>([["jumps", { a: 1 }], [1, "one"], [2.5, "x"], [undefined, 3], ["over", undefined], [null, 4]]);
const large = new Map<string, string>(); for (let i = 0; i < 300; i++) large.set("w" + i, "v" + i); large.set("lazy", "found"); large.set("brown", "also");
const doubles = new Map<string, number>(); for (let i = 0; i < 20; i++) doubles.set("d" + i, i + 0.5); doubles.set("quick", 1e300);
const empty = new Map<string, number>();
let log = "";
function ask(text: string) {
    const identifiers = new Map<string, string>();
    for (const word of split(text)) {
        const k = keywords.get(word), again = keywords.get(word), c = constant.get(word), m = mixed.get(word), l = large.get(word), d = doubles.get(word), e = empty.get(word);
        let id = identifiers.get(word); if (id === undefined) identifiers.set(word, id = word);
        log += word.length + ":" + k + again + Object.is(c, -0) + c + (m === undefined ? "u" : typeof m) + l + d + e + (id === word) + identifiers.has(word) + ";";
    }
    return identifiers.size;
}
for (let k = 0; k < 4; k++) log += ask(words) + "\n";
// the same rope in many maps, then resolved
const piece = words.substring(4, 9); let n = 0; for (let i = 0; i < 100; i++) { n += doubles.get(piece)! === 1e300 ? 1 : 0; n += keywords.get(piece) === undefined ? 2 : 0; n += large.get(piece) === undefined ? 4 : 0; n += mixed.get(piece) === undefined ? 8 : 0; }
log += n + piece + piece.length + JSON.stringify(piece) + ({ quick: 1 } as any)[piece] + "\n";
const set = new Set<string>(); for (const w of split(words)) { if (keywords.get(w) === undefined && !set.has(w)) set.add(w); } log += [...set].join() + "\n";
// equal hashes are told apart by characters; lengths 1, 2, 48, 49
for (const len of [0, 1, 2, 47, 48, 49]) { const t = "x".repeat(60).substring(3, 3 + len); const map = new Map<string, number>([["x".repeat(48), 48], ["x".repeat(49), 49], ["x", 1]]); log += len + " " + map.get(t) + map.get(t) + map.has(t) + map.get("x".repeat(len)) + "\n"; map.set(t, -1); log += map.get(t) + " " + map.size + map.delete(t) + map.get(t) + "\n"; }
console.log(log);
let total = 0; for (let k = 0; k < 2000; k++) { for (const w of split(words)) { total += keywords.get(w) ?? 0; if (constant.get(w) !== undefined) total++; if (large.get(w) === "found") total += 3; } } console.log(total);
