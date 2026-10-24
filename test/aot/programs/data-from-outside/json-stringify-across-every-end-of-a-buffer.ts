// JSON.stringify of compiled objects writes keys, numbers and short strings into room that it has asked for once.
// Here every such write is moved across every place where a buffer ends or grows: the 8,192 characters on the stack, and 1,024 doubled.
// What is written is compared with the text for ordinary objects with the same members, made by run-time text.
const toPlain = new Function("value", `
    function copy(v) {
        if (Array.isArray(v)) return v.map(copy);
        if (v && typeof v === "object") { const r = {}; for (const k of Object.keys(v)) r[k] = copy(v[k]); return r; }
        return v;
    }
    return copy(value);`) as <V>(value: V) => V;

class Text { constructor(public s: string) {} }
class Keys { a = 1; abcdefghijklm = 2; abcdefghijklmn = 3; abcdefghijklmno = 4; abcdefghijklmnop = 5; abcdefghijklmnopqrstuvwxyz01234 = 6; abcdefghijklmnopqrstuvwxyz012345 = 7; abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz01234567 = 8; "quo\"te" = 9; "é" = 10; }
class Numbers { least = -2147483648; most = 2147483647; long = -1.7976931348623157e308; small = 5e-324; third = -0.3333333333333333; nan = NaN; infinite = -Infinity; zero = -0; yes = true; no = false; none = null; missing = undefined; }
class Mixed {
    id = 7; flag = true; none = null; ratio = 1.5;
    constructor(public name: string, public inner: Text, public list: Text[], public tags: string[]) {}
}
class Deep { constructor(public next: Deep | null, public label: string) {} }

function deep(levels: number, label: string): Deep { let d: Deep = new Deep(null, label); for (let i = 0; i < levels; i++) d = new Deep(d, label); return d; }
const tails = ["", "\"", "\\", "\n", "\u001f", "é", "中", "\ud800"];
const lengths = [0, 1, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 100, 300, 1100];
const texts: string[] = [];
for (const length of lengths) for (const tail of tails) { texts.push("s".repeat(length) + tail); if (tail) texts.push(tail + "s".repeat(length)); }

let calls = 0, wrong = 0, hash = 0;
function check(value: unknown, space: string | number | undefined): void {
    const got = JSON.stringify(value, null, space);
    const want = JSON.stringify(toPlain(value), null, space);
    calls++;
    hash = (hash * 31 + got.length) | 0;
    if (got !== want && wrong++ < 5) console.log("DIFFERS", got.length, want.length, String(space), got.slice(0, 60));
}

const big = "t".repeat(9000);
const spaces = [undefined, 1, 10, "\t"];
let turn = 0;
for (const end of [1024, 2048, 4096, 8192, 16384, 32768]) {
    for (let room = 330; room >= -12; room -= room > 140 ? 7 : 1) {
        const filler = "x".repeat(end - room);
        const text = texts[turn++ % texts.length];
        const space = spaces[turn % spaces.length];
        for (const last of ["", big]) {
            check([filler, new Keys(), last], space);
            check([filler, new Numbers(), last], space);
            check([filler, new Text(text), last], space);
            check([filler, new Mixed(text, new Text(text), [new Text(text), new Text("")], [text, "t"]), last], space);
            check([new Text(filler), new Text(text), new Text(text), new Text(last)], space);
            check([new Mixed(filler, new Text(""), [], []), new Mixed(text, new Text(text), [new Text(text)], [text]), new Mixed(last, new Text(text), [], [])], space);
            check({ filler, keys: new Keys(), numbers: new Numbers(), last }, space);
            check(new Mixed(filler, new Text(text), [new Text(text), new Text(text), new Text(text)], [last]), space);
        }
    }
}
for (const text of texts) for (const space of spaces) {
    check(new Text(text), space); check([new Text(text), new Text(text)], space); check(new Mixed(text, new Text(text), [new Text(text)], [text]), space);
}
for (const levels of [1, 2, 10, 60, 200, 700]) for (const space of [undefined, 1, 10, "0123456789"]) for (const label of ["", "l", "\n", "中", "l".repeat(40)]) check(deep(levels, label), space);
console.log(calls, wrong, hash);
