// A string is walked character by character while, in the same loop, it is used as a property key for the first time, and memory is collected.
function make(prefix: string, n: number): string { let s = prefix; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 26); return s; }
function fresh(text: string): string { return (text + "!").slice(0, -1); }
function copyOf(text: string): string { return text.split("").join(""); }
function pressure(): number { let t = 0; for (let i = 0; i < 300; i++) { const a = make("p" + i, 40); t += a.length; } Bun.gc(true); return t; }
const table: Record<string, number> = {};
function walk(o: Record<string, number>, s: string): number {
    let t = 0;
    for (let i = 0; i < s.length; i++) {
        t = (t * 31 + s.charCodeAt(i)) | 0;
        if (i === 3) { t += o[s] | 0; pressure(); }
        if (i === 9) { o[s] = i; pressure(); }
    }
    return t;
}
function walkIndex(o: Record<string, number>, s: string): string {
    let t = "";
    for (let i = 0; i < s.length; i++) {
        if (i === 2) { if (s in o) t += "+"; pressure(); }
        t += s[i];
        if (i === 5) { t += Object.hasOwn(o, s) ? "y" : "n"; pressure(); }
    }
    return t;
}
function walkUntyped(o: any, s: any): number {
    let t = 0;
    const n = s.length;
    for (let i = 0; i < n; i++) {
        t = (t + s.codePointAt(i)) | 0;
        if (i === 1) { o[s]; Symbol.for(s); pressure(); }
    }
    return t;
}
function compare(o: Record<string, number>, a: string, b: string): boolean {
    let same = true;
    for (let i = 0; i < 6; i++) {
        same = same && a === b;
        if (i === 1) { o[a] = 1; pressure(); }
        if (i === 3) { o[b] = 2; pressure(); }
    }
    return same;
}
for (const length of [1, 5, 12, 17, 40, 300, 5000]) {
    const text = make("k" + length, length);
    table[text] = length;                      // The name exists before the other strings of the same text become names.
    const results: (string | number | boolean)[] = [];
    results.push(walk(table, fresh(text)), walk(table, copyOf(text)), walk({}, fresh(text + "x")), walk({}, copyOf(text + "y")));
    results.push(walkIndex(table, fresh(text)).length, walkIndex(table, copyOf(text)) === walkIndex({}, fresh(text)).replace("n", "y").replace(/^(..)/, "$1+"));
    results.push(walkUntyped(table, fresh(text)), walkUntyped(new Map(), copyOf(text)), walkUntyped({}, fresh(text + "z")));
    results.push(compare({}, fresh(text), copyOf(text)), compare(table, copyOf(text), fresh(text)));
    console.log(length, results.join(" "));
}
const wide = make("中文", 30);
table[wide] = 1;
console.log(walk(table, fresh(wide)), walkIndex(table, copyOf(wide)).length, walkUntyped(table, fresh(wide)));
