// Built-ins called with boxed operands: each row once where the short road answers and once where the call leaves for the host's function.
function says(make: () => unknown): void {
    try {
        const said = make();
        console.log(typeof said, Array.isArray(said) ? JSON.stringify(said) : Object.is(said, -0) ? "-0" : String(said));
    } catch (error) {
        console.log((error as Error).name);
    }
}
export function starts(text: string, prefix: string) { return text.startsWith(prefix); }
export function ends(text: string, suffix: string) { return text.endsWith(suffix); }
export function finds(text: string, sought: string, from: number) { return text.indexOf(sought, from); }
export function findsLast(text: string, sought: string, from: number) { return text.lastIndexOf(sought, from); }
export function holds(text: string, sought: string) { return text.includes(sought); }
export function cuts(text: string, from: number, to: number) { return text.slice(from, to); }
export function parts(text: string, at: string) { return text.split(at); }
export function swaps(text: string, old: string, fresh: string) { return text.replace(old, fresh); }
export function unit(text: string, at: number) { return text.charCodeAt(at); }
export function letter(text: string, at: number) { return text.charAt(at); }
export function written(value: unknown) { return JSON.stringify(value); }
export function least(a: number, b: number) { return Math.min(a, b); }
export function owns(object: object, key: string) { return Object.prototype.hasOwnProperty.call(object, key); }
export function same(a: unknown, b: unknown) { return Object.is(a, b); }
export function list(value: unknown) { return Array.isArray(value); }
export function adds(values: unknown[], value: unknown) { return values.push(value); }
export function above(value: object) { return Object.getPrototypeOf(value); }

const rows: Record<string, Function> = { starts, ends, finds, findsLast, holds, cuts, parts, swaps, unit, letter, written, least, owns, same, list, adds, above };
const spelled = { toString() { return "b"; } };
const counted = { valueOf() { return 1; } };
const thrower = { valueOf(): number { throw new RangeError("no"); }, toString(): string { throw new RangeError("no"); } };
const given: Record<string, unknown[][]> = {
    starts: [["abc", "ab"], ["abc", "c"], ["12", 1], ["undefined", undefined], ["bc", spelled], ["a", /a/], ["a", thrower], [12, "1"], [null, "n"]],
    ends: [["abc", "bc"], ["abc", "a"], ["12", 2], ["ab", spelled], ["a", /a/], ["ЖЗ", "З"], [true, "ue"], [undefined, "d"]],
    finds: [["abcabc", "c", 3], ["abcabc", "c", "3"], ["abcabc", spelled, 2], ["a1", 1, undefined], ["abc", "c", 1.5], ["abc", "c", thrower], ["abc", "c", -Infinity]],
    findsLast: [["abcabc", "c", 3], ["abcabc", "a", 0], ["abcabc", "c", "3"], ["abcabc", spelled, counted], ["abc", "c", NaN]],
    holds: [["abc", "b"], ["abc", "x"], ["a1", 1], ["abc", /b/], ["abc", spelled]],
    cuts: [["abcdef", 1, 3], ["abcdef", -2, undefined], ["abcdef", "1", counted], ["abcdef", thrower, 2], ["abcdef", 1.9, 4.2]],
    parts: [["a-b-c", "-"], ["abc", ""], ["a1b1c", 1], ["a-b", /-/], ["a-b", undefined]],
    swaps: [["abc", "b", "x"], ["abc", "b", "$&$&"], ["abc", /b/g, "x"], ["abc", "b", () => "y"], ["a1", 1, 2]],
    unit: [["abc", 1], ["abc", 9], ["abc", "1"], ["abc", counted], ["abc", -1], ["Ж", 0], ["abc", 1.5]],
    letter: [["abc", 1], ["abc", 9], ["abc", "2"], ["abc", undefined]],
    written: [["text"], [1], [null], [undefined], [{ a: 1, b: [1, 2] }], [[1, "2"]], [() => 1], [{ toJSON() { return "mine"; } }], [1n]],
    least: [[1, 2], [2.5, -0], ["3", 2], [counted, 4], [NaN, 1], [thrower, 1]],
    owns: [[{ a: 1 }, "a"], [{ a: 1 }, "b"], [[1], 0], ["text", "length"], [{ 1: 1 }, counted], [null, "a"]],
    same: [[-0, 0], [NaN, NaN], ["a", "a"], [spelled, spelled], [1, 1.0]],
    list: [[[]], [{}], ["a"], [new Proxy([], {})], [undefined]],
    adds: [[[1], 2], [[1.5], "a"], [[], undefined], [Object.freeze([1]), 2], [{ length: 2 }, 1]],
    above: [[[]], [{}], [Object.create(null)], ["text"], [null], [new Proxy({}, { getPrototypeOf() { return Array.prototype; } })]],
};
for (let turn = 0; turn < 3; turn++) {
    for (const name of Object.keys(rows)) {
        for (const operands of given[name]) {
            if (name === "above")
                says(() => { const found = rows[name](...operands); return found === Array.prototype ? "lists" : found === Object.prototype ? "objects" : found === String.prototype ? "texts" : found; });
            else
                says(() => rows[name](...operands));
        }
    }
}
