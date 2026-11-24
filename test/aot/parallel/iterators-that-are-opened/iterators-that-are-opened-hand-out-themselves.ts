// for-of, spread and patterns over what is an iterator already: the method under Symbol.iterator that it inherits answers the iterator itself.
const log: string[] = [];
function note(text: unknown) { log.push(String(text)); }
function says(name: string, make: () => unknown): void {
    try { note(name + ": " + JSON.stringify(make())); } catch (error) { note(name + ": " + (error as Error).name); }
}
export function first(values: Iterable<unknown>): unknown { for (const value of values) return value; return "nothing"; }
export function all(values: Iterable<unknown>): unknown[] { const list: unknown[] = []; for (const value of values) list.push(value); return list; }
export function two(values: Iterable<unknown>): unknown[] { const [a, b] = values; return [a, b]; }
function* counts(to: number) { try { for (let i = 0; i < to; i++) yield i; } finally { note("closed at " + to); } }
class Steps extends Iterator<number> { left = 3; next(): any { return this.left-- > 0 ? { value: this.left, done: false } : { value: undefined as any, done: true }; } }
class Turned extends Iterator<number> { next(): any { return { value: 1, done: true }; } [Symbol.iterator]() { note("own method"); return [7, 8][Symbol.iterator]() as any; } }
const inherited = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))[Symbol.iterator];
for (let turn = 0; turn < 3; turn++) {
    says("the first of a generator", () => first(counts(3)));
    says("the first of an empty generator", () => first(counts(0)));
    says("all of a generator", () => all(counts(3)));
    says("two of a generator", () => two(counts(5)));
    { const left = counts(4); says("one taken", () => first(left)); says("and the rest", () => all(left)); }
    { const left = counts(4); left.next(); says("begun by hand", () => all(left)); }
    says("the values of a table", () => all(new Map([[1, "a"], [2, "b"]]).values()));
    says("the keys of a table", () => first(new Map([[1, "a"]]).keys()));
    says("the entries of a set", () => all(new Set(["x"]).entries()));
    says("the values of a list", () => all([1, 2, 3].values()));
    says("the entries of a list", () => two(["a", "b"].entries()));
    says("the iterator of a text", () => all("a\u{1F600}"[Symbol.iterator]()));
    says("matches", () => all("a1b2".matchAll(/\d/g)).length);
    says("a helper", () => all(counts(4).map(x => x * 2)));
    says("a helper of a helper", () => first(new Set([1, 2, 3]).values().filter(x => x > 1).take(1)));
    says("made from an object", () => all(Iterator.from({ next() { return { value: 1, done: true }; } })));
    says("a class below", () => all(new Steps()));
    says("a class below with a method of its own", () => all(new Turned()));
    says("the method borrowed", () => { let left = 2; return all({ [Symbol.iterator]: inherited, next() { return left-- > 0 ? { value: left, done: false } : { value: undefined, done: true }; } } as any); });
    says("the method borrowed, no next", () => all({ [Symbol.iterator]: inherited } as any));
    says("the method bound", () => all({ [Symbol.iterator]: inherited.bind(counts(2)) } as any));
    says("a proxy", () => all(new Proxy(new Steps(), { get(target, key) { note("get " + String(key)); const found = Reflect.get(target, key, target); return typeof found === "function" ? found.bind(target) : found; } })));
    says("a getter", () => all({ get [Symbol.iterator]() { note("getter"); return inherited; }, next() { return { done: true, value: 0 }; } } as any));
    { const own: any = counts(3); own[Symbol.iterator] = function () { note("written on it"); return [4][Symbol.iterator](); }; says("its own method written", () => all(own)); }
    { const cut: any = counts(3); Object.setPrototypeOf(cut, null); says("its chain cut", () => all(cut)); }
    { const moved: any = new Map([[1, 2]]).keys(); Object.setPrototypeOf(moved, { [Symbol.iterator]() { note("moved"); return [6][Symbol.iterator](); } }); says("its chain moved", () => all(moved)); }
    says("spread", () => [...counts(2), ...new Set([5]).values()]);
    says("handed on", () => Math.max(...[3, 9, 4].values()));
    says("into a table", () => new Map(new Map([[1, 2]]).entries()).size);
    says("from", () => Array.from(counts(3), x => x + 1));
    says("nothing", () => all(undefined as any));
    says("a number", () => all(5 as any));
}
console.log(log.join("\n"));
