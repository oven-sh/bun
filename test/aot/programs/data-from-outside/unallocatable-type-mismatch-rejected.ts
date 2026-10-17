// Objects from untyped code of which nothing can be made and that DO NOT satisfy the record type are refused where they meet it, as before: the required member is nowhere, or holds what is no object and does not fit.
type Whole = { k: { id?: number }; n: number };
function own(): Whole { return { k: { id: 7 }, n: 1 }; }
function take(answer: Whole): unknown { return [answer.k.id, answer.n]; }
function attempt(name: string, f: () => unknown): void { try { console.log(name, JSON.stringify(f())); } catch (e) { console.log(name, (e as Error).name); } }
console.log(JSON.stringify(take(own())));
attempt("a function without the member:", () => take(Object.assign(function () {}, { n: 1 }) as any));
attempt("a Map without the member:", () => take(Object.assign(new Map(), { k: {} }) as any));
attempt("an array whose member is a string:", () => take(Object.assign([1], { k: {}, n: "one" }) as any));
attempt("an inherited member that is a string:", () => take(Object.create({ k: {}, n: "one" }) as any));
attempt("an accessor beside a member that is a string:", () => take(Object.defineProperty({ n: "one" }, "k", { get() { return {}; }, enumerable: true }) as any));
attempt("an accessor that yields a string, where it is read:", () => take(Object.defineProperty({ k: {} }, "n", { get() { return "one"; }, enumerable: true }) as any));
attempt("a function that has both:", () => take(Object.assign(function () {}, { k: { id: 2 }, n: 3 }) as any));
