declare const console: { log(...values: unknown[]): void };
function wholes(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i * 7 - 20); return a; }
function halves(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i / 4 - 1); return a; }
const makers: [string, () => unknown][] = [
    ["none", () => wholes(0)], ["one", () => wholes(1)], ["wholes", () => wholes(12)], ["halves", () => halves(12)],
    ["edges", (): number[] => [0, -0, 1, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 9007199254740991, -9007199254740991, 1e21, 1e-7, 123456789012345680000, 5e-324, 1.7976931348623157e308]],
    ["not finite", (): number[] => [1, Infinity, 2, -Infinity, 3.5]],
    ["NaN", (): number[] => [1.5, NaN, 2]],
    ["a hole", (): number[] => { const a = [1.5, 2, 3]; delete (a as unknown[])[1]; return a; }],
    ["holes alone", (): number[] => new Array<number>(3)],
    ["longer than filled", (): number[] => { const a = [1, 2.5]; a.length = 4; return a; }],
    ["shortened", (): number[] => { const a = wholes(9); a.length = 2; return a; }],
    ["parsed", () => JSON.parse("[1,2,3]")], ["parsed mixed", () => JSON.parse("[1,2.5,-0,1e3]")],
    ["rows", (): number[][] => [wholes(3), halves(3), [], [0.1]]],
    ["in a record", () => ({ id: 7, list: wholes(4), nested: { list: halves(2) }, text: "t" })],
    ["beside wide text", () => ({ text: "世界", list: wholes(5), more: halves(3) })],
    ["wide text behind", () => [wholes(5), halves(3), "世"]],
    ["with a name", () => { const a = wholes(3); (a as unknown as { tag: string }).tag = "t"; return a; }],
    ["with toJSON", () => { const a = wholes(3); (a as unknown as { toJSON: () => string }).toJSON = () => "mine"; return a; }],
    ["frozen", () => Object.freeze(halves(3))],
    ["an heir", () => { class Mine extends Array<number> { } const a = new Mine(); a.push(1, 2.5); return a; }],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of makers) {
        console.log(name + ": " + JSON.stringify(make()) + " | " + JSON.stringify(make(), null, 1) + " | " + JSON.stringify(make(), null, "\t·") + " | " + JSON.stringify(make(), (_, v) => typeof v === "number" ? v + 1 : v) + " | " + JSON.stringify({ a: make() }));
    }
    for (const n of [100, 2000, 60000]) {
        const w = JSON.stringify(wholes(n)), h = JSON.stringify(halves(n)), g = JSON.stringify(wholes(n), null, 2);
        let sum = 0;
        for (let i = 0; i < w.length; i += 97) sum += w.charCodeAt(i) + h.charCodeAt(i % h.length) + g.charCodeAt(i % g.length);
        console.log(n + ": " + w.length + " " + h.length + " " + g.length + " " + sum + " " + w.slice(-24) + " " + h.slice(-24) + " " + (JSON.parse(w) as number[]).length + " " + (JSON.parse(h) as number[])[n - 1]);
    }
}
