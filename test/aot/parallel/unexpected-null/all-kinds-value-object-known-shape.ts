// A member is read from, stored to and called on a value that unseen code handed over. The shape that the types name is tested for; undefined and null throw; every other value goes by name.
interface Item { weight: number; label: string; next: Item | null; grow(by: number): number }
const launder = new Function("v", "return v" + String(process.argv[9] ?? "").slice(99)) as <V>(v: V) => V;
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
function make(weight: number, next: Item | null): Item { return launder({ weight, label: "item " + weight, next, grow(by: number) { return (this.weight += by); } }); }
function read(item: Item): number { return item.weight; }
function readTwice(item: Item): string { return item.label + item.weight; }
function store(item: Item): number { item.weight = 5; return item.weight; }
function call(item: Item): number { return item.grow(2); }
function readInsideTry(item: Item): string { try { return "read " + item.weight; } catch (error) { return "caught " + (error as Error).constructor.name; } finally { seen++; } }
function total(head: Item | null): number { let sum = 0; for (let item = head; item !== null; item = item.next) sum += item.weight; return sum; }
function secondWeight(item: Item): number { return item.next!.weight; }
let seen = 0;
let held: Item = make(1, null);
function readHeld(): number { return held.weight + held.label.length; }
const chain = make(3, make(2, make(1, null)));
const others: unknown[] = [undefined, null, 0, -0, 1.5, NaN, "text", "", true, false, Symbol.iterator, 10n, [1, 2], { weight: 7 }, { label: "no weight" }, Object.create({ weight: 9 }), Object.create(null),
    () => 1, new Map(), new Proxy({}, { get: (_, key) => "proxied " + String(key), set: () => true }), Object.freeze({ weight: 4, label: "frozen", next: null }), chain];
for (let round = 0; round < 3; round++) {
    for (const other of others) {
        const item = launder(other) as Item;
        attempt("read", () => read(item)); attempt("twice", () => readTwice(item)); attempt("store", () => store(item)); attempt("call", () => call(item));
        attempt("try", () => readInsideTry(item)); attempt("total", () => total(item)); attempt("second", () => secondWeight(item));
        held = item; attempt("held", readHeld);
    }
}
attempt("ends in undefined", () => total(make(1, launder(undefined) as unknown as Item)));
attempt("ends in a number", () => total(make(1, launder(5) as unknown as Item)));
console.log(seen, total(chain));
