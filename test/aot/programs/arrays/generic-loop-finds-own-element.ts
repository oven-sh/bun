// forEach, some, every, reduce and `in` on what is no plain array (an instance of a class that extends Array, an object that is like an array) find an element that is there without asking the run time. What is absent is asked for the way the language has it.
declare const console: { log(...values: unknown[]): void };
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const asked = () => (counted ? counted("operationAOTInByVal") + counted("operationAOTElementOrEmpty") : 0);
class Rows<T> extends Array<T> {}
class Inherits<T> extends Array<T> {}
(Inherits.prototype as any)[1] = "inherited";
function filled<L extends unknown[]>(list: L, ...values: unknown[]): L { for (const value of values) list.push(value); return list; }
function walk(list: any): string {
    let said = "";
    list.forEach((x: unknown, i: number) => { said += i + ":" + x + " "; });
    said += list.some((x: unknown) => x === "nowhere") + " ";
    said += list.every((x: unknown) => x !== "nowhere") + " ";
    said += list.reduce((sum: any, x: unknown) => sum + String(x).length, 0) + " ";
    said += (0 in list) + " " + (1 in list) + " " + (2 in list) + " ";
    return said;
}
function tell(name: string, list: unknown, isFoundInPlace: boolean): void {
    walk(list);
    const before = asked();
    let said = "";
    for (let round = 0; round < 100; round++) said = walk(list);
    const times = asked() - before;
    console.log(name + ": " + said + (!counted || (isFoundInPlace ? times === 0 : times > 0)));
}
const likeAnArray = (members: object) => Object.assign(Object.create({ forEach: Array.prototype.forEach, some: Array.prototype.some, every: Array.prototype.every, reduce: Array.prototype.reduce }), members);
tell("strings", filled(new Rows<string>(), "a", "b", "c"), true);
tell("integers", filled(new Rows<number>(), 1, 2, 3), true);
tell("numbers", filled(new Rows<number>(), 1.5, 2.5, 3.5), true);
tell("like an array", likeAnArray({ length: 3, 0: "a", 1: "b", 2: "c" }), true);
tell("an array", ["a", "b", "c"], true);
tell("a hole below an element of the prototype", (() => { const list = filled(new Inherits<string>(), "a", "b", "c"); delete list[1]; return list; })(), false);
tell("a hole", (() => { const list = filled(new Rows<string>(), "a", "b", "c"); delete list[1]; return list; })(), false);
tell("a hole in an array", (() => { const list = ["a", "b", "c"]; delete list[1]; return list; })(), true);
tell("shorter than it says", likeAnArray({ length: 3, 0: "a" }), false);
