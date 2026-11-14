// Texts that grow by short pieces, end with a long one and are keys of maps and sets.
function scan(source, escapes) {
    let contents = "", start = 0;
    for (let i = 0; i < source.length; i++) {
        if (source.charCodeAt(i) !== 92)
            continue;
        contents += source.substring(start, i);
        contents += escapes[source[i + 1]] ?? source[i + 1];
        start = ++i + 1;
    }
    contents += source.substring(start);
    return contents;
}

function sum(text) {
    let total = text.length;
    for (let i = 0; i < text.length; i++)
        total = total * 31 + text.charCodeAt(i) | 0;
    return total;
}

const interned = new Map();
function intern(text) {
    let found = interned.get(text);
    if (found === undefined)
        interned.set(text, found = { text, id: interned.size });
    return found;
}

const escapes = { n: "\n", t: "\t", e: "€" };
function sourceOf(lines, escape) {
    let source = "";
    for (let i = 0; i < lines; i++)
        source += "line " + i + " of a template with some words in it\\" + escape;
    return source;
}

for (const lines of [10, 500, 1500, 4000]) {
    for (const escape of ["n", "e"]) {
        for (const tail of ["", "end", "x".repeat(20000), "y".repeat(400000)]) {
            const source = sourceOf(lines, escape) + tail;
            const first = scan(source, escapes);
            const entry = intern(first);
            const again = intern(scan(source, escapes));
            console.log(lines, escape, tail.length, entry === again, entry.id, sum(entry.text) === sum(first), sum(again.text), entry.text.endsWith(tail));
        }
    }
}

// Two ends of one text.
let text = "";
for (let i = 0; i < 20000; i++)
    text += "word" + i % 10;
const tails = ["a", "b".repeat(300), "c".repeat(17000), "d".repeat(30000), "Ж".repeat(20)];
const ends = tails.map(tail => text + tail);
const set = new Set(ends);
console.log(set.size, ends.map(sum).join());
for (let i = 0; i < tails.length; i++)
    console.log(set.has(text + tails[i]), set.has(text + tails[i] + "!"), ends[i].startsWith(text), ends[i].slice(text.length) === tails[i]);
text += "z";
set.add(text);
console.log(set.size, set.has(text), sum(text), ends.map(sum).join());

// A text that is a key each time it has grown.
const seen = new Map();
let growing = "";
for (let i = 0; i < 6000; i++) {
    growing += "piece " + i % 7 + ";";
    if (i > 5000 && i % 50 === 0) {
        seen.set(growing, i);
        if (i % 200 === 0)
            growing += "q".repeat(18000);
    }
}
console.log(seen.size, sum(growing), [...seen.keys()].map(sum).join());
let matches = 0;
for (const [key, value] of seen)
    matches += seen.get(key.slice(0, 70000) + key.slice(70000)) === value;
console.log(matches);

// The same of texts that grow in a field.
class Writer {
    text = "";
    write(piece) { this.text += piece; }
}
const writers = [new Writer(), new Writer()];
for (let i = 0; i < 12000; i++) {
    for (const writer of writers)
        writer.write(i % 3 ? "word " : "Word" + i % 5);
}
for (const writer of writers) {
    const longEnds = ["c".repeat(17000), "d".repeat(30000), "\u0416".repeat(20000)].map(tail => writer.text + tail);
    const longFound = new Map();
    for (const end of longEnds)
        longFound.set(end, end.length);
    console.log(longFound.size, longEnds.map(sum).join(), [...longFound.keys()].map(sum).join(), sum(writer.text));
    const ends = tails.map(tail => writer.text + tail);
    const found = new Map();
    for (const end of ends)
        found.set(end, end.length);
    console.log(found.size, ends.map(sum).join(), sum(writer.text));
    for (let i = 0; i < tails.length; i++)
        console.log(found.get(writer.text + tails[i]), ends[i].startsWith(writer.text), ends[i].slice(writer.text.length) === tails[i]);
    writer.write("more");
    const longer = writer.text + "e".repeat(20000);
    found.set(longer, -1);
    writer.write("still more");
    console.log(found.size, found.get(longer), sum(longer), sum(writer.text), ends.map(sum).join(), [...found.keys()].map(sum).join());
    const inner = writer.text + ("f".repeat(300) + ends[0].slice(0, 5)) + "g";
    console.log(sum(inner), new Set([inner, inner + "h", inner]).size, sum(writer.text), [...found.keys()].map(sum).join());
    console.log(longEnds.map(sum).join(), longFound.get(longEnds[0]), longFound.get(writer.text + "c"), longFound.get(longEnds[1].slice(0, 1) + longEnds[1].slice(1)));
}
