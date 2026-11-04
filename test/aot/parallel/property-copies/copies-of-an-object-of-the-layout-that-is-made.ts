// `{ ...state }` where the source has the type of the literal: the words of the cell are copied, whichever of the keys the source has and in whatever order it got them.
// A source that has more than its words say (a key outside the type, a value that its field does not hold, a getter, a key that is not enumerable, an integrity level) goes by the copy as written.
type State = { a: number; b?: string; c?: number[]; d?: State; e: boolean };
type Wide = { k0: number; k1?: number; k2?: number; k3?: number; k4?: number; k5?: number; k6?: number; k7?: number; k8?: number; k9?: number; k10?: number; k11?: number; k12?: string; k13?: number; k14?: number; k15?: number; k16?: number; k17?: number; k18?: number; k19: number };
const say = (value: unknown) => console.log(String(value));
const seen = (o: object) => JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join() + " " + Object.isFrozen(o) + Object.isSealed(o) + Object.isExtensible(o) + " " + (Object.getPrototypeOf(o) === Object.prototype);
function copy(state: State): State { return { ...state }; }
function changed(state: State, a: number): State { return { ...state, a }; }
function grown(state: State, b: string): State { return { ...state, b }; }
function first(state: State): State { return { a: -1, e: false, ...state }; }
function both(one: State, other: State): State { return { ...one, ...other }; }
function wide(w: Wide): Wide { return { ...w }; }
function many(state: State, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { const next = { ...state, a: i }; sum += next.a + (next.b ? next.b.length : 0); state = next; } return sum; }
function tell(f: () => unknown) { try { say(f()); } catch (thrown) { say((thrown as Error).name); } }
function whole(): State { return { a: 1, b: "two", c: [3], e: true }; }
function least(): State { return { a: 1, e: false }; }
const [extra, nameOfA, nameOfB, nameOfC, later] = JSON.parse('["extra","a","b","c","later"]') as string[];
const put = (o: object, key: PropertyKey, value: unknown) => { Reflect.set(o, key, value); };
const inOrder = whole();
const few = least();
const otherOrder = least(); otherOrder.c = [1]; otherOrder.b = "late";
const nested = least(); nested.d = least();
const deleted = whole(); Reflect.deleteProperty(deleted, nameOfB);
const putBack = whole(); Reflect.deleteProperty(putBack, nameOfB); put(putBack, nameOfB, "back");
const more = least(); put(more, extra, "outside"); put(more, 3, "index"); put(more, Symbol.for("s"), "symbol");
const misfit = least(); put(misfit, nameOfA, "no number"); put(misfit, nameOfC, 7);
const getter = least(); let reads = 0; Object.defineProperty(getter, nameOfB, { get() { reads++; return "got"; }, enumerable: true, configurable: true });
const hidden = whole(); Object.defineProperty(hidden, nameOfB, { enumerable: false });
const readOnly = whole(); Object.defineProperty(readOnly, nameOfB, { writable: false });
const frozen = Object.freeze(whole());
const sealed = Object.seal(whole());
const closed = Object.preventExtensions(least());
const below = least(); Object.setPrototypeOf(below, { b: "inherited", z: 1 });
const bare: State = Object.assign(Object.create(null), { a: 1, e: true });
const proxied: State = new Proxy(least(), { ownKeys: t => Reflect.ownKeys(t).reverse() });
class Made { a = 1; e = true; get b() { return "of the class"; } }
const sources: State[] = [inOrder, few, otherOrder, nested, deleted, putBack, more, misfit, getter, hidden, readOnly, frozen, sealed, closed, below, bare, proxied, new Made() as State, JSON.parse('{"e":false,"zz":1,"a":5}'), [1, 2] as any, "text" as any, 5 as any, null as any, undefined as any];
for (let round = 0; round < 3; round++) {
    sources.forEach(s => tell(() => seen(copy(s))));
    sources.forEach(s => tell(() => seen(changed(s, 9))));
    sources.forEach(s => tell(() => seen(grown(s, "new"))));
    sources.forEach(s => tell(() => seen(first(s))));
    sources.forEach(s => tell(() => seen(both(s, few)) + seen(both(few, s))));
}
say(reads);
const kept = copy(inOrder); kept.a = 100; kept.c!.push(4); put(kept, later, 1); Reflect.deleteProperty(kept, nameOfB);
say(seen(kept) + " " + seen(inOrder) + " " + (kept.c === inOrder.c));
const copyOfCopy = copy(copy(copy(otherOrder))); copyOfCopy.d = few; say(seen(copyOfCopy) + seen(otherOrder));
const full: Wide = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9, k10: 10, k11: 11, k12: "12", k13: 13, k14: 14, k15: 15, k16: 16, k17: 17, k18: 18, k19: 19 };
const thin: Wide = { k19: 19, k0: 0 }; thin.k12 = "twelve"; thin.k7 = 7.5;
[full, thin, Object.freeze({ ...full }), { ...thin, k5: 5 }].forEach(w => { tell(() => seen(wide(w))); tell(() => seen(wide(wide(w)))); });
tell(() => many(few, 1000)); tell(() => many(inOrder, 1000)); tell(() => many(more, 10)); tell(() => many(frozen, 10));
say("end");
