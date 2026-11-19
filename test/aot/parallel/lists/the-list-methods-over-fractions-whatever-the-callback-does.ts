const seed = process.argv.length;
const fresh = (): number[] => { const l: number[] = []; for (let i = 0; i < 7; i++) l.push(seed / 4 + i + 0.25); return l; };
const written = (): number[] => [seed + 0.5, seed / 3, 2.5, seed + 3.75];
type Deed = (list: any, index: number) => void;
const deeds: [string, Deed][] = [
    ["nothing", () => {}],
    ["pushes", (l, i) => { if (i < 3) l.push(i + 0.125); }],
    ["pops", (l, i) => { if (i === 1) l.pop(); }],
    ["cuts", (l, i) => { if (i === 2) l.length = 3; }],
    ["empties", (l, i) => { if (i === 0) l.length = 0; }],
    ["stores a text ahead", (l, i) => { if (i === 1) l[3] = "text"; }],
    ["stores NaN ahead", (l, i) => { if (i === 1) l[2] = NaN; }],
    ["stores an int ahead", (l, i) => { if (i === 0) l[1] = 7; }],
    ["stores an object behind", (l, i) => { if (i === 2) l[0] = { k: 1 }; }],
    ["deletes ahead", (l, i) => { if (i === 1) delete l[3]; }],
    ["stores far behind the end", (l, i) => { if (i === 1) l[40] = 1.5; }],
    ["lays an accessor ahead", (l, i) => { if (i === 0) Object.defineProperty(l, 2, { get: () => -1.5, configurable: true, enumerable: true }); }],
    ["freezes", (l, i) => { if (i === 1) Object.freeze(l); }],
    ["reverses", (l, i) => { if (i === 1) l.reverse(); }],
    ["fills with -0", (l, i) => { if (i === 1) l.fill(-0, 2); }],
    ["throws", (_, i) => { if (i === 2) throw new RangeError("at two"); }],
];
const show = (v: unknown): string => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : Array.isArray(v) ? "[" + Array.from(v, show).join() + "]#" + v.length : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const methods: [string, (l: any, deed: Deed, seen: string[]) => unknown][] = [
    ["forEach", (l, d, s) => l.forEach(function (this: unknown, x: unknown, i: number, a: unknown) { s.push(show(x) + (a === l ? "" : "!") + (this === s ? "" : "?")); d(l, i); }, s)],
    ["map", (l, d, s) => l.map((x: any, i: number) => { s.push(show(x)); d(l, i); return typeof x === "number" ? x * 2 : x; })],
    ["filter", (l, d, s) => l.filter((x: any, i: number) => { s.push(show(x)); d(l, i); return i % 2 === 0; })],
    ["reduce", (l, d, s) => l.reduce((a: any, x: any, i: number) => { s.push(show(x)); d(l, i); return a + x; }, 0.5)],
    ["reduce without a start", (l, d, s) => l.reduce((a: any, x: any, i: number) => { s.push(show(x)); d(l, i); return a + x; })],
    ["some", (l, d, s) => l.some((x: any, i: number) => { s.push(show(x)); d(l, i); return i === 5; })],
    ["every", (l, d, s) => l.every((x: any, i: number) => { s.push(show(x)); d(l, i); return i < 5; })],
    ["find", (l, d, s) => l.find((x: any, i: number) => { s.push(show(x)); d(l, i); return i === 4; })],
    ["findIndex", (l, d, s) => l.findIndex((x: any, i: number) => { s.push(show(x)); d(l, i); return x === undefined || i === 5; })],
];
class Kept extends Array<number> { static get [Symbol.species]() { return Array; } }
const makers: [string, () => any][] = [["pushed", fresh], ["written", written], ["with a hole", () => { const l = fresh(); delete (l as any)[3]; return l; }], ["of a class below", () => Kept.from(fresh())], ["int32s", () => [seed, seed + 1, seed + 2, 4, 5]], ["boxed", () => [seed + 0.5, "b", null, 4.5]], ["like a list", () => ({ length: 3, 0: 0.5, 1: 1.5, 2: 2.5 })]];
let lines = 0, digest = 0;
for (let turn = 0; turn < 40; turn++) {
    for (const [made, make] of makers) for (const [name, method] of methods) for (const [deedName, deed] of deeds) {
        const list = make(), seen: string[] = []; let answer: string;
        try { answer = show(made === "like a list" ? method(Object.assign(Object.create(Array.prototype), list), deed, seen) : method(list, deed, seen)); } catch (error) { answer = (error as Error).constructor.name + ": " + (error as Error).message.slice(0, 40); }
        const line = made + " . " + name + " . " + deedName + " > " + answer + " | " + seen.join(" ") + " | " + show(Array.isArray(list) ? list : 0);
        if (turn === 39) { lines++; for (let c = 0; c < line.length; c++) digest = (digest * 31 + line.charCodeAt(c)) | 0; if (lines % 37 === 0 || made === "written" && deedName !== "nothing" && name === "map") console.log(line); }
    }
}
console.log(lines, digest);
