// Literals with characters beyond ASCII, and strings from outside that are kept in 8 or 16 bits, as ropes and as slices. A string passes the cast whether it spells one of the literals or almost does, and compares equal only to what it spells.
type Word = "é" | "naïve" | "日本語" | "a😀b" | "\ud800" | "x\udc00y" | "ÿ" | "plain" | "a much longer text that goes on for more than sixty-four characters, so that no small buffer holds it";
class Entry {
    constructor(public word: Word, public other: Word | undefined = undefined) {}
}
function rank(w: Word): number {
    switch (w) {
        case "é": return 1;
        case "naïve": return 2;
        case "日本語": return 3;
        case "a😀b": return 4;
        case "\ud800": return 5;
        case "x\udc00y": return 6;
        case "ÿ": return 7;
        case "plain": return 8;
        case "a much longer text that goes on for more than sixty-four characters, so that no small buffer holds it": return 9;
        default: return 0;
    }
}
function codes(s: string): string {
    let all = "";
    for (let i = 0; i < s.length; i++) all += s.charCodeAt(i).toString(16) + ".";
    return all;
}
const parsed: string[] = JSON.parse('["é","naïve","日本語","a😀b","\\\\ud800","x\\\\udc00y","ÿ","plain","e","naive","日本","a😀","\\\\ud801"]'.replaceAll("\\\\\\\\", "\\\\"));
const entries: Entry[] = [];
for (const text of parsed) {
    try { entries.push(new Entry(text as Word)); } catch (e) { console.log("no word:", codes(text), (e as Error).constructor.name); }
}
console.log(entries.map(e => rank(e.word)).join());
const wide = "日é naïve ÿ plain";
const sliced = [wide.slice(1, 2), wide.slice(3, 8), wide.slice(9, 10), wide.slice(11)];
console.log(sliced.map(s => rank(new Entry(s as Word).word)).join(), sliced.map(codes).join(" "));
const ropes = ["na" + "ïve", "日本" + "語", "a" + "😀" + "b", "a\ud83d" + "\ude00b", "pl" + ["a", "i", "n"].join(""), "x" + String.fromCharCode(0xdc00) + "y", String.fromCharCode(0xd800)];
console.log(ropes.map(s => rank(new Entry(s as Word).word)).join());
const long = ["a much longer text that goes on for more than sixty-four characters,", " so that no small buffer holds it"];
function rankOf(s: string): number | string {
    try { return rank(new Entry(s as Word).word); } catch (e) { return (e as Error).constructor.name; }
}
console.log(rankOf(long[0] + long[1]), rankOf(long[0] + long[1] + "!"), rankOf(long[0]));
const kept = new Entry("日本語", "a😀b");
console.log(kept.word, kept.other, kept.word.length, kept.other!.length, codes(kept.word), codes(kept.other!), JSON.stringify(kept), kept.word === parsed[2], kept.other === ropes[3]);
const lone = new Entry("\ud800", "x\udc00y");
console.log(codes(lone.word), codes(lone.other!), JSON.stringify(lone), lone.word === String.fromCharCode(0xd800), lone.other === ropes[5]);
let same = 0;
for (const a of entries) for (const b of entries) same += a.word === b.word ? 1 : 0;
console.log(same);
