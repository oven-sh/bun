declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public n: number) { } }
let depth = 0;
function popRec(list: Rec[]): Rec | undefined { if (depth > 0) { depth--; popRec(list); } return list.pop(); }
function popText(list: string[]): string | undefined { if (depth > 0) { depth--; popText(list); } return list.pop(); }
function popNumber(list: number[]): number | undefined { if (depth > 0) { depth--; popNumber(list); } return list.pop(); }
function popUnknown(list: unknown[]): unknown { if (depth > 0) { depth--; popUnknown(list); } return list.pop(); }
function popEither(list: (Rec | number)[]): Rec | number | undefined { if (depth > 0) { depth--; popEither(list); } return list.pop(); }
function atRec(list: Rec[], index: number): Rec | undefined { if (depth > 0) { depth--; atRec(list, index); } return list.at(index | 0); }
function atText(list: string[], index: number): string | undefined { if (depth > 0) { depth--; atText(list, index); } return list.at(index | 0); }
function atNumber(list: number[], index: number): number | undefined { if (depth > 0) { depth--; atNumber(list, index); } return list.at(index | 0); }
function atUnknown(list: unknown[], index: number): unknown { if (depth > 0) { depth--; atUnknown(list, index); } return list.at(index | 0); }
function describe(value: unknown): string { return value === undefined ? "undefined" : value === null ? "null" : value instanceof Rec ? "Rec " + value.n : typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value)); }
function report(name: string, run: () => string): void { let text: string; try { text = run(); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); } console.log(name + ": " + text); }
function drain<T>(list: T[], pop: (list: T[]) => unknown): string { let out = ""; for (let i = 0; i < 6; i++) out += describe(pop(list)) + "/" + list.length + " "; return out; }
const R = (n: number) => new Rec(n);
for (let round = 0; round < 2; round++) {
    report("recs", () => drain([R(1), R(2), R(3)], popRec));
    report("texts", () => drain(["a", "b"], popText));
    report("integers", () => drain([1, 2, 3], popNumber));
    report("doubles", () => drain([1.5, 2.5, -0, NaN], popNumber));
    report("unknown integers", () => drain<unknown>([1, 2], popUnknown));
    report("unknown doubles", () => drain<unknown>([1.5, 2.5], popUnknown));
    report("unknown mixed", () => drain<unknown>([1, "a", R(2), null, undefined], popUnknown));
    report("either", () => drain<Rec | number>([R(1), 2, 3.5], popEither));
    report("either doubles", () => drain<Rec | number>([1.5, 2.5], popEither));
    report("empty", () => drain<Rec>([], popRec));
    report("holes", () => { const list = [R(1), R(2), R(3)]; delete (list as unknown[])[2]; return drain(list, popRec); });
    report("holes among doubles", () => { const list = [1.5, 2.5, 3.5]; delete (list as unknown[])[2]; return drain(list, popNumber); });
    report("new Array(3)", () => drain(new Array<Rec>(3), popRec));
    report("lengthened", () => { const list = [R(1)]; list.length = 3; return drain(list, popRec); });
    report("frozen", () => drain(Object.freeze([R(1), R(2)]) as Rec[], popRec));
    report("constants", () => drain(["x", "y", "z"], popText));
    report("sparse", () => { const list = [R(1)]; list[100000] = R(2); return describe(popRec(list)) + "/" + list.length + " " + describe(popRec(list)) + "/" + list.length; });
    report("inherited in a hole", () => { const list = [R(1), , ] as Rec[]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 1: R(50) }); return describe(popRec(list)) + "/" + list.length; });
    report("subclass", () => { class Mine extends Array<Rec> { } const list = new Mine(); list.push(R(1), R(2)); return drain(list, popRec); });
    report("JSON", () => drain(JSON.parse('["p","q"]') as string[], popText));
    for (const index of [0, 1, 2, 3, -1, -2, -3, -4, 100, -100, 2147483647, -2147483648]) {
        report("at " + index, () => [describe(atRec([R(1), R(2), R(3)], index)), describe(atText(["a", "b", "c"], index)), describe(atNumber([1, 2, 3], index)), describe(atNumber([1.5, 2.5, 3.5], index)), describe(atUnknown([1.5, 2.5, 3.5], index)), describe(atUnknown([1, "b", R(3)], index)), describe(atRec([], index))].join(" "));
    }
    report("at a hole", () => { const list = [R(1), R(2), R(3)]; delete (list as unknown[])[1]; const numbers = [1.5, 2.5, 3.5]; delete (numbers as unknown[])[1]; return describe(atRec(list, 1)) + " " + describe(atNumber(numbers, 1)) + " " + describe(atRec(list, -2)); });
}
