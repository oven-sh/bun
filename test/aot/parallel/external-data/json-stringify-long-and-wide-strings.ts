// Strings of every length around the sizes of a vector, of a piece and of the buffers, with every kind of character that is escaped at every place that matters, written by the serializers
// the compiler generates and by the engine's fast stringifier (the calls with an indentation of 0, which the compiler leaves to the engine). Each result is compared with one made by this program.
// None of them needs the general serializer.
// COUNTER: JSONStringifySlowPaths = 0
declare const console: { log(...values: unknown[]): void };

function quoteUnit(text: string, index: number): string {
    const unit = text.charCodeAt(index);
    switch (unit) {
    case 0x22: return '\\"';
    case 0x5c: return "\\\\";
    case 8: return "\\b";
    case 9: return "\\t";
    case 10: return "\\n";
    case 12: return "\\f";
    case 13: return "\\r";
    }
    if (unit < 0x20 || (unit >= 0xd800 && unit <= 0xdfff))
        return "\\u" + (0x10000 + unit).toString(16).slice(1);
    return text[index];
}

function quoteContent(text: string): string {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
            parts.push(text[i] + text[i + 1]);
            i++;
        } else
            parts.push(quoteUnit(text, i));
    }
    return parts.join("");
}

let cases = 0;
let mismatches = 0;
let lengths = 0;

function check(what: string, actual: string | undefined, expected: string): void {
    cases++;
    lengths = (lengths + expected.length) % 1000000007;
    if (actual === expected)
        return;
    if (++mismatches > 8)
        return;
    let at = 0;
    const text = actual ?? "";
    while (at < text.length && at < expected.length && text.charCodeAt(at) === expected.charCodeAt(at))
        at++;
    console.log("MISMATCH " + what + ": lengths " + text.length + " and " + expected.length + ", first difference at " + at);
}

const specials = ['"', "\\", "\n", "\t", "\0", "\x1f", "\x7f", "\xe9", "\xff", "Ā", "→", "\ud83d", "\ude00", "😀", "\ude00\ud83d", '\ud83d"', "\\\ude00"];
const sizes = [1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 62, 63, 64, 65, 66, 127, 128, 129, 255, 256, 257, 258, 511, 512, 513, 1000, 4095, 4096, 4097, 4098, 8190, 8192, 8194, 12290];
const places = [0, 1, 7, 8, 15, 16, 17, 62, 63, 64, 254, 255, 256, 257, 511, 512, 4094, 4095, 4096, 4097, 8191, 8192];

const narrowFiller = "a".repeat(5000);
const longNarrowFiller = "b".repeat(9000);
const parsed = JSON.parse('{"text":""}');
const parsedLate = JSON.parse('{"filler":"","text":""}');
parsedLate.filler = narrowFiller;
const parsedBehindFullBuffer = JSON.parse('{"filler":"","list":[""]}');
parsedBehindFullBuffer.filler = longNarrowFiller;

function checkEverywhere(what: string, text: string, content: string): void {
    check(what + " alone", JSON.stringify(text), '"' + content + '"');
    check(what + " in an object", JSON.stringify({ key: text, after: 1 }), '{"key":"' + content + '","after":1}');
    check(what + " in an array", JSON.stringify([text, text]), '["' + content + '","' + content + '"]');
    check(what + " late", JSON.stringify([narrowFiller, text]), '["' + narrowFiller + '","' + content + '"]');
    check(what + " behind a full buffer", JSON.stringify({ filler: longNarrowFiller, text }), '{"filler":"' + longNarrowFiller + '","text":"' + content + '"}');
    check(what + " indented", JSON.stringify([text], null, 2), '[\n  "' + content + '"\n]');
    parsed.text = text;
    check(what + " in parsed data", JSON.stringify(parsed, null, 0), '{"text":"' + content + '"}');
    check(what + " in parsed data, indented", JSON.stringify(parsed, null, "\t"), '{\n\t"text": "' + content + '"\n}');
    parsedLate.text = text;
    check(what + " late in parsed data", JSON.stringify(parsedLate, null, 0), '{"filler":"' + narrowFiller + '","text":"' + content + '"}');
    parsedBehindFullBuffer.list[0] = text;
    check(what + " behind a full buffer in parsed data", JSON.stringify(parsedBehindFullBuffer, null, 0), '{"filler":"' + longNarrowFiller + '","list":["' + content + '"]}');
}

for (const size of sizes) {
    for (const special of specials) {
        const escaped = quoteContent(special);
        for (const place of [...places, size - special.length - 1, size - special.length]) {
            if (place < 0 || place + special.length > size)
                continue;
            const before = "a".repeat(place);
            const after = "z".repeat(size - place - special.length);
            const text = before + special + after;
            const what = "size " + size + " special " + escaped + " at " + place;
            checkEverywhere(what, text, before + escaped + after);
            checkEverywhere(what + " cut out of wide text", ("→" + text).slice(1), before + escaped + after);
            checkEverywhere(what + " in front of wide text", text + "✓", before + escaped + after + "✓");
        }
    }
}
console.log("placed:", cases, "cases,", mismatches, "mismatches, lengths", lengths);

let seed = 12345;
function random(limit: number): number {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return (seed >>> 8) % limit;
}

function randomText(length: number, kinds: number): string {
    const units: number[] = [];
    for (let i = 0; i < length; i++) {
        switch (random(kinds)) {
        case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: units.push(0x20 + random(0x5f)); break;
        case 8: units.push(random(0x20)); break;
        case 9: units.push(random(2) ? 0x22 : 0x5c); break;
        case 10: units.push(0x80 + random(0x80)); break;
        case 11: units.push(0x100 + random(0xd700)); break;
        case 12: units.push(0xd800 + random(0x800)); break;
        default: units.push(0xd800 + random(0x400), 0xdc00 + random(0x400)); break;
    }
    }
    let text = "";
    for (let i = 0; i < units.length; i += 4096)
        text += String.fromCharCode(...units.slice(i, i + 4096));
    return text;
}

for (let i = 0; i < 3000; i++) {
    const text = randomText(random(i % 50 ? 700 : 20000), 8 + random(7));
    checkEverywhere("random " + i, text, quoteContent(text));
}
console.log("random:", cases, "cases,", mismatches, "mismatches, lengths", lengths);

type Entry = { role: string; text: string; id: number };
function entries(count: number, wideAt: number): Entry[] {
    const list: Entry[] = [];
    for (let i = 0; i < count; i++)
        list.push({ role: i & 1 ? "one" : "other", text: "line " + i + "\n\tof \"text\"" + "-".repeat(i * 7 % 300) + (i === wideAt ? "→" : ""), id: i });
    return list;
}
function expectedEntries(list: Entry[]): string {
    return "[" + list.map(entry => '{"role":"' + entry.role + '","text":"' + quoteContent(entry.text) + '","id":' + entry.id + "}").join(",") + "]";
}
for (const count of [1, 10, 40, 41, 60, 200, 2000]) {
    for (const wideAt of [-1, 0, -1, -1, count - 1, count - 1, -1, count >> 1, 0, -1]) {
        const list = entries(count, wideAt);
        check("entries " + count + " wide at " + wideAt, JSON.stringify(list), expectedEntries(list));
        check("parsed entries " + count + " wide at " + wideAt, JSON.stringify(JSON.parse(expectedEntries(list)), null, 0), expectedEntries(list));
        check("entries left to the engine " + count + " wide at " + wideAt, JSON.stringify(list, null, 0), expectedEntries(list));
    }
}
console.log("in turn:", cases, "cases,", mismatches, "mismatches, lengths", lengths);
