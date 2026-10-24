// Keys cut out of a text: read and then stored under, asked for with `in` and then stored under, once and again, by fresh strings and by strings that are kept.
const text = "the quick brown fox jumps over the lazy dog and the quick cat sleeps while the dog barks at the fox";
const lines: string[] = [];
function words(): string[] { return text.split(" "); }
function count(list: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const word of list) counts[word] = (counts[word] ?? 0) + 1;
    return counts;
}
function show(record: Record<string, unknown>): string {
    return Object.keys(record).map(key => key + ":" + String(record[key])).join(" ");
}
lines.push("counted: " + show(count(words())));
lines.push("again: " + show(count(words())));
const kept = words();
lines.push("by kept strings: " + show(count(kept)) + " | " + show(count(kept)) + " | " + show(count(kept)));
const groups: Record<string, string[]> = {};
for (const word of words()) {
    const key = word.slice(0, 1);
    if (!(key in groups)) groups[key] = [];
    groups[key]!.push(word);
}
lines.push("grouped: " + Object.keys(groups).map(key => key + "=" + groups[key]!.length).join(" "));
const first: Record<string, number> = {};
words().forEach((word, index) => { first[word] ??= index; });
lines.push("first seen: " + show(first));
const lengths: Record<string, number> = {};
for (let round = 0; round < 3; round++) {
    for (const word of kept) {
        const before = lengths[word];
        lengths[word] = before === undefined ? word.length : before + 1;
    }
}
lines.push("three rounds: " + show(lengths));
const two: Record<string, number> = {};
const other: Record<string, number> = {};
for (const word of words()) {
    const seen = two[word];
    other[word] = (seen ?? 0) + 1;
    two[word] = (other[word] ?? 0) + 1;
}
lines.push("two tables: " + show(two) + " | " + show(other));
let total = 0;
const big: Record<string, number> = {};
for (let turn = 0; turn < 3000; turn++) {
    const key = "k" + (turn % 700);
    big[key] = (big[key] ?? 0) + turn;
    total += big[key]!;
}
lines.push("many: " + total + " " + Object.keys(big).length);
console.log(lines.join("\n"));
