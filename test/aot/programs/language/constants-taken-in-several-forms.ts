// One constant is an index here, a fraction's partner there, a boxed argument, a field of a narrow slot, a key: each use takes it in its own form.
declare const console: { log(...values: unknown[]): void };

class Record { count = 0; ratio = 0.5; label = "zero"; maybe: number | undefined = undefined; any: unknown = null; on = false; }
function show(...values: unknown[]): string { return values.map(value => typeof value + ":" + String(value)).join(" "); }

function seven(list: number[], record: Record): string {
    const n = 7;
    list[n] = n;
    record.count = n;
    record.ratio = n;
    record.maybe = n;
    record.any = n;
    return show(n, n + 0.5, n | 8, n / 2, list[n], "x".repeat(n).length, n === record.count, String(n));
}

function words(record: Record, pick: boolean): string {
    const word = "word";
    record.label = word;
    record.any = word;
    const other = pick ? word : "other";
    return show(word, word.length, word + other, word === other, { word }[word], other.charCodeAt(0), [word].includes(other));
}

function nothings(record: Record, pick: number): string {
    record.maybe = undefined;
    record.any = undefined;
    const value = pick === 0 ? undefined : pick === 1 ? null : pick === 2 ? false : 0;
    record.any = value;
    return show(value, value ?? "default", value == null, !value, record.maybe, record.any, [undefined, null, true, false]);
}

const list: number[] = [];
const record = new Record();
console.log(seven(list, record), JSON.stringify(record), list.length);
console.log(words(record, true), "|", words(record, false), JSON.stringify(record));
for (let pick = 0; pick < 4; pick++) console.log(nothings(record, pick));
