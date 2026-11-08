// `holder[name]` under a name that only the run knows, where the name is a field that the holder was written with. The read is repeated until where the field lies is remembered;
// then the holder changes in every way that a read must hear of. Fields of every form stand side by side: any value, numbers alone, texts alone, objects alone, booleans alone.
const names = ["any", "count", "ratio", "label", "inner", "flag"];
function take(holder, name) { return holder[name]; }
class Gate { constructor(n) { this.any = n % 2 ? n : "n" + n; this.count = n; this.ratio = n + 0.5; this.label = "l" + n; this.inner = { n }; this.flag = n % 2 === 0; } }
class Door extends Gate { constructor(n) { super(n); this.lock = n; } }
const makers = {
    literal: n => ({ any: n % 2 ? n : "n" + n, count: n, ratio: n + 0.5, label: "l" + n, inner: { n }, flag: n % 2 === 0 }),
    otherOrder: n => ({ flag: n % 2 === 0, inner: { n }, label: "l" + n, ratio: n + 0.5, count: n, any: n % 2 ? n : "n" + n }),
    withoutPrototype: n => ({ __proto__: null, any: undefined, count: n, ratio: n + 0.5, label: "l" + n, inner: null, flag: n % 2 === 0 }),
    instance: n => new Gate(n),
    derived: n => new Door(n),
};
function tell(value) { return typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + ":" + String(value); }
const ways = {
    nothing: holder => {},
    deleted: holder => { delete holder.any; delete holder.count; },
    deletedAll: holder => { for (const name of names) delete holder[name]; },
    deletedAboveValues: holder => { Object.setPrototypeOf(holder, { any: "any above", count: "count above", inner: "inner above" }); delete holder.any; delete holder.count; delete holder.inner; },
    deletedAndLaidAgain: holder => { delete holder.any; delete holder.label; holder.label = 5; holder.any = null; },
    getter: holder => { Object.defineProperty(holder, "any", { get() { return "got " + this.count; }, configurable: true }); },
    otherKinds: holder => { holder.any = { swapped: 1 }; holder.count = "text"; holder.ratio = 3; holder.label = undefined; holder.inner = 7; holder.flag = null; },
    frozen: holder => { Object.freeze(holder); },
    more: holder => { holder.added = 1; },
};
for (const kind in makers) {
    for (const way in ways) {
        const holder = makers[kind](3);
        const other = makers[kind](4);
        let warm = 0;
        for (let round = 0; round < 60; round++) {
            for (const name of names) warm += tell(take(holder, name)).length + tell(take(other, name)).length;
        }
        ways[way](holder);
        console.log(kind, way, warm, "|", names.map(name => tell(take(holder, name))).join(" "), "|", names.map(name => tell(take(other, name))).join(" "));
    }
}
