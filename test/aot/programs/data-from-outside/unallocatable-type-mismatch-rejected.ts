// Objects from untyped code that are no plain objects (a function, a Map, an array, an object with inherited members or accessors) and do not satisfy the record type enter a typed parameter: any object passes. A member that is missing reads undefined, as in plain Bun. A member of the wrong kind throws where typed code reads it.
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
