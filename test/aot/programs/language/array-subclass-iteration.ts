const lines: string[] = [];
function show(value: unknown): string { return JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : v)); }
function attempt(name: string, run: () => unknown): void {
    let said: string;
    try { said = show(run()); } catch (e) { said = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message; }
    lines.push(name + " | " + said);
}
function hide(value: unknown): any { return value; }
function forOf(x: any): unknown[] { const out: unknown[] = []; for (const v of x) out.push(v); return out; }
function spread(x: any): unknown[] { return [...x]; }
function spreadBehind(x: any): unknown[] { return ["first", ...x, "last"]; }
function take(x: any): unknown[] { const [a, b, c, d] = x; return [a, b, c, d]; }
function rest(x: any): unknown[] { const [a, ...others] = x; return [a, others]; }
function call(x: any): unknown { return ((...all: unknown[]) => all.length + ":" + all.join())(...x); }
function typed(x: number[]): number { let sum = 0; for (const v of x) sum += v; return sum; }
const uses: [string, (x: any) => unknown][] = [["for of", forOf], ["spread", spread], ["spread behind", spreadBehind], ["take", take], ["rest", rest], ["call", call]];
const noted: string[] = [];
class Plain extends Array<any> { }
class Deeper extends Plain { }
class WithElementOnPrototype extends Array<any> { }
hide(WithElementOnPrototype.prototype)[1] = "from the prototype";
class WithGetterOnPrototype extends Array<any> { }
Object.defineProperty(WithGetterOnPrototype.prototype, 1, { get() { noted.push("getter"); return "got"; }, configurable: true });
class WithLengthGetter extends Array<any> { get size() { return this.length; } }
Object.defineProperty(WithLengthGetter.prototype, "length", { get() { noted.push("length of the prototype"); return 99; }, configurable: true });
class OwnIteration extends Array<any> { *[Symbol.iterator](): ArrayIterator<any> { yield "own iteration"; } }
class HeirOfOwnIteration extends OwnIteration { }
class BackToValues extends OwnIteration { [Symbol.iterator]() { return Array.prototype.values.call(this); } }
class Keys extends Array<any> { [Symbol.iterator]() { return this.keys() as any; } }
class GetterForIteration extends Array<any> { }
Object.defineProperty(GetterForIteration.prototype, Symbol.iterator, { get() { noted.push("the iterator is read"); return Array.prototype.values; }, configurable: true });
class Later extends Array<any> { }
class LaterDeeper extends Later { }
const holes = <T extends any[]>(x: T): T => { x.push(1, 2, 3); delete x[1]; return x; };
const makers: [string, () => any][] = [
    ["plain", () => Plain.from([1, 2, 3])], ["deeper", () => Deeper.from([1, 2, 3])], ["empty", () => new Plain()], ["of doubles", () => Plain.from([1.5, 2.5])], ["of texts", () => Plain.from(["a", "b"])], ["with a hole", () => holes(new Plain())],
    ["a hole, an element on the prototype", () => holes(new WithElementOnPrototype())], ["a hole, a getter on the prototype", () => holes(new WithGetterOnPrototype())], ["no hole, an element on the prototype", () => WithElementOnPrototype.from([1, 2, 3])],
    ["length on the prototype", () => WithLengthGetter.from([1, 2])], ["own iteration", () => OwnIteration.from([1, 2])], ["heir of own iteration", () => HeirOfOwnIteration.from([1, 2])], ["back to values", () => BackToValues.from([1, 2])], ["keys", () => Keys.from(["a", "b"])],
    ["a getter for the iteration", () => GetterForIteration.from([1, 2])], ["an iterator of its own", () => Object.assign(Plain.from([1, 2]), { [Symbol.iterator]: function* () { yield "its own"; } })], ["values of its own", () => Object.assign(Plain.from([1, 2]), { [Symbol.iterator]: Array.prototype.values })],
    ["an iterator of its own that is undefined", () => Object.assign(Plain.from([1, 2]), { [Symbol.iterator]: undefined })], ["an accessor element", () => Object.defineProperty(Plain.from([1, 2, 3]), 1, { get() { noted.push("element"); return "accessor"; } })],
    ["frozen", () => Object.freeze(Plain.from([1, 2]))], ["sparse", () => { const x = new Plain(); x[0] = "a"; x[100000] = "z"; x.length = 3; return x; }], ["a named property", () => Object.assign(Plain.from([1, 2]), { extra: 1 })],
    ["the prototype is a proxy", () => Object.setPrototypeOf([1, 2], new Proxy(Array.prototype, { get(t, k, r) { noted.push("proxy " + String(k)); return Reflect.get(t, k, r); } }))], ["a proxy further up", () => Object.setPrototypeOf([1, 2], Object.create(new Proxy(Array.prototype, { get(t, k, r) { noted.push("far proxy " + String(k)); return Reflect.get(t, k, r); } })))],
    ["no prototype", () => Object.setPrototypeOf([1, 2], null)], ["Object.prototype", () => Object.setPrototypeOf([1, 2], Object.prototype)], ["an empty object between", () => Object.setPrototypeOf([1, 2], Object.create(Array.prototype))], ["another array as the prototype", () => Object.setPrototypeOf([1, , 3], ["p0", "p1", "p2", "p3"])],
    ["an heir as the prototype", () => Object.setPrototypeOf([1, , 3], OwnIteration.from([7]))],
];
for (const [kind, make] of makers)
    for (const [use, run] of uses)
        attempt(kind + " | " + use, () => { noted.length = 0; const result = run(make()); return noted.length ? [result, noted.slice()] : result; });
attempt("typed over heirs", () => [typed(Plain.from([1, 2, 3])), typed(Deeper.from([4, 5])), typed(new Plain())]);
attempt("the class is given an iteration later", () => { const x = Later.from([1, 2]), y = LaterDeeper.from([3]); const before = [forOf(x), spread(y)]; hide(Later.prototype)[Symbol.iterator] = function* () { yield "later"; }; const behind = [forOf(x), spread(y), take(x)]; delete hide(Later.prototype)[Symbol.iterator]; return [before, behind, forOf(x), spread(y)]; });
attempt("the prototype changes under way", () => { const x = Plain.from([1, 2, 3]); const out: unknown[] = []; for (const v of x) { out.push(v); Object.setPrototypeOf(x, OwnIteration.prototype); } return [out, forOf(x)]; });
attempt("it is given an iterator under way", () => { const x = hide(Plain.from([1, 2, 3])); const out: unknown[] = []; for (const v of x) { out.push(v); x[Symbol.iterator] = function* () { yield "new"; }; } return [out, forOf(x)]; });
attempt("it grows and shrinks under way", () => { const x = Plain.from([1, 2, 3]); const out: unknown[] = []; for (const v of x) { out.push(v); if (v === 1) x.push(4, 5); if (v === 3) x.length = 3; } return out; });
attempt("a hole appears under way", () => { const x = WithElementOnPrototype.from([1, 2, 3]); const out: unknown[] = []; for (const v of x) { out.push(v); delete x[1]; } return out; });
attempt("left early", () => { const out: unknown[] = []; for (const v of Plain.from([1, 2, 3])) { out.push(v); if (v === 2) break; } return out; });
console.log(lines.join("\n"));
