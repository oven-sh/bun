// New objects are stored to, and pushed onto, instances of classes that extend Array that have grown old: a young collection finds them only if the store has told the collector.
declare const console: { log(...values: unknown[]): void };
declare function fullGC(): void;
declare function edenGC(): void;
class Item { constructor(public id: number, public name: string) {} }
class Rows<T> extends Array<T> {}
class Labelled<T> extends Array<T> { label = "rows"; owner: Item | null = null; }
function storeTyped(a: Item[], i: number, x: Item): void { a[i] = x; }
function storeAny(a: any, i: any, x: any): void { a[i] = x; }
function pushTyped(a: Item[], x: Item): void { a.push(x); }
function pushAny(a: any, x: any): void { a.push(x); }
function pushRows(a: Rows<Item>, x: Item): void { a.push(x); }
function pushTwo(a: Item[], x: Item, y: Item): void { a.push(x, y); }
function appendAtLength(a: Item[], x: Item): void { a[a.length] = x; }
function fillTyped(a: Item[], from: number, x: Item): void { a.fill(x, from, from + 2); }
function spliceIn(a: Item[], at: number, x: Item): void { a.splice(at, 1, x); }
function unshiftTyped(a: Item[], x: Item): void { a.unshift(x); a.pop(); }
function check(a: Item[]): string { let ids = 0, letters = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; ids += x.id; letters += x.name.length; } return a.length + ":" + ids + ":" + letters; }
function litter(): number { let n = 0; for (let i = 0; i < 400; i++) n += [new Item(i, "litter" + i), { i }, "s" + i].length; return n; }
let next = 1000;
const fresh = () => new Item(next++, "n" + next);
const lists: [string, Item[]][] = [["rows", new Rows<Item>()], ["labelled", new Labelled<Item>()], ["of", Rows.of(fresh(), fresh())], ["from", Rows.from([fresh(), fresh()])], ["mapped", Rows.from([1, 2]).map(() => fresh())], ["array", []]];
for (const [, list] of lists) for (let i = 0; i < 12; i++) list.push(fresh());
fullGC(); fullGC();
const steps: [string, (a: Item[], round: number) => void][] = [
    ["store, typed", (a, r) => storeTyped(a, r % a.length, fresh())],
    ["store, any", (a, r) => storeAny(a, (r + 3) % a.length, fresh())],
    ["push, typed", a => pushTyped(a, fresh())],
    ["push, any", a => pushAny(a, fresh())],
    ["push, by the class", a => pushRows(a as Rows<Item>, fresh())],
    ["push two", a => pushTwo(a, fresh(), fresh())],
    ["at the length", a => appendAtLength(a, fresh())],
    ["fill", (a, r) => fillTyped(a, r % 8, fresh())],
    ["splice", (a, r) => spliceIn(a, r % 8, fresh())],
    ["unshift", a => unshiftTyped(a, fresh())],
    ["a field", a => { if (a instanceof Labelled) a.owner = fresh(); }],
];
for (const [name, step] of steps) {
    for (const [which, list] of lists) {
        let said = "";
        for (let round = 0; round < 6; round++) {
            step(list, round);
            edenGC();
            litter();
            said += check(list) + (list instanceof Labelled && list.owner ? "/" + list.owner.id + list.owner.name : "") + " ";
            if (round === 3) fullGC();
        }
        console.log(name + " | " + which + " | " + said);
    }
}
