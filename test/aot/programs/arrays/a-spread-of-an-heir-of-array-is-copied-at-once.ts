// `[...rows]` of an instance of a class that extends Array, where the class leaves the iteration of arrays as it is, copies the elements at once. One that has an iterator of its own, or a hole, is stepped through.
declare const console: { log(...values: unknown[]): void };
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const steppedThrough = () => (counted ? counted("AppendSpread:iterated") : 0);
class Rows<T> extends Array<T> {}
class Backwards<T> extends Array<T> {}
(Backwards.prototype as any)[Symbol.iterator] = function* (this: unknown[]) { for (let i = this.length; i--;) yield this[i]; };
function filled<L extends unknown[]>(list: L, ...values: unknown[]): L { for (const value of values) list.push(value); return list; }
function copyOf(list: any): unknown[] { return [...list]; }
function copyBehind(list: any): unknown[] { return ["first", ...list, "last"]; }
function tell(name: string, list: unknown[], isCopiedAtOnce: boolean): void {
    const before = steppedThrough();
    let said = "";
    for (let round = 0; round < 200; round++) said = JSON.stringify(copyOf(list)) + " " + JSON.stringify(copyBehind(list)) + " " + copyOf(list).constructor.name;
    const times = steppedThrough() - before;
    console.log(name + ": " + said + " " + (!counted || (isCopiedAtOnce ? times === 0 : times === 600)));
}
tell("strings", filled(new Rows<string>(), "a", "b", "c"), true);
tell("integers", filled(new Rows<number>(), 1, 2, 3), true);
tell("numbers", filled(new Rows<number>(), 1.5, 2.5), true);
tell("objects", filled(new Rows<object>(), { a: 1 }, { a: 2 }), true);
tell("none", new Rows<string>(), false);
tell("of", Rows.of("a", "b"), true);
tell("an iterator of its own", filled(new Backwards<string>(), "a", "b", "c"), false);
tell("a hole", (() => { const list = filled(new Rows<string>(), "a", "b", "c"); delete list[1]; return list; })(), false);
tell("an array", ["a", "b", "c"], true);
