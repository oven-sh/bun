// `[...rows]` of an instance of a class that extends Array: where the class leaves the iteration of arrays as it is the elements can be copied at once; one that has an iterator of its own, or a hole, has to be stepped through.
declare const console: { log(...values: unknown[]): void };
class Rows<T> extends Array<T> {}
class Backwards<T> extends Array<T> {}
(Backwards.prototype as any)[Symbol.iterator] = function* (this: unknown[]) { for (let i = this.length; i--;) yield this[i]; };
function filled<L extends unknown[]>(list: L, ...values: unknown[]): L { for (const value of values) list.push(value); return list; }
function copyOf(list: any): unknown[] { return [...list]; }
function copyBehind(list: any): unknown[] { return ["first", ...list, "last"]; }
function tell(name: string, list: unknown[]): void {
    let said = "";
    for (let round = 0; round < 200; round++) said = JSON.stringify(copyOf(list)) + " " + JSON.stringify(copyBehind(list)) + " " + copyOf(list).constructor.name;
    console.log(name + ": " + said);
}
tell("strings", filled(new Rows<string>(), "a", "b", "c"));
tell("integers", filled(new Rows<number>(), 1, 2, 3));
tell("numbers", filled(new Rows<number>(), 1.5, 2.5));
tell("objects", filled(new Rows<object>(), { a: 1 }, { a: 2 }));
tell("none", new Rows<string>());
tell("of", Rows.of("a", "b"));
tell("an iterator of its own", filled(new Backwards<string>(), "a", "b", "c"));
tell("a hole", (() => { const list = filled(new Rows<string>(), "a", "b", "c"); delete list[1]; return list; })());
tell("an array", ["a", "b", "c"]);
