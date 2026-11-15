// Under: --aot-testing=CheckWalkAtRunTime: every untyped read is looked up again
// A getter that only returns a field is read as the field.
class Node { constructor(i) { this._kind = i; this._half = i + 0.5; this._wide = 2 ** 31 + i; if (i & 1) this._late = "l" + i; } get kind() { return this._kind; } get half() { return this._half; } get wide() { return this._wide; } get late() { return this._late; } get twice() { return this._kind * 2; } }
class Heir extends Node { constructor(i) { super(i); this.pad = i; this._own = { i }; } get own() { return this._own; } get kind() { return this._kind + 1; } }
class Other { constructor(i) { this.q = 1; this._kind = "o" + i; this._late = i & 2 ? null : undefined; } get kind() { return this._kind; } get late() { return this._late; } get wide() { return 1; } }
globalThis[["ke", "pt"].join("")] = [Node, Heir, Other];
const list = [];
for (let i = 0; i < 18; i++) list.push(new globalThis.kept[i % 3](i));
globalThis.list = list;
const read = o => [o.kind, o.half, o.wide, o.late, o.twice, o.own?.i].join();
const tested = o => (o.late ? "y" : "n") + (o.kind ? 1 : 0) + ("late" in o) + (o.half === undefined);
for (let turn = 0; turn < 3; turn++) {
    console.log(globalThis.list.map(read).join(" "));
    console.log(globalThis.list.map(tested).join(" "));
    for (const o of globalThis.list) { o._late = turn ? o : 0; o._half += 0.25; }
}
delete globalThis.list[0]._kind;
Object.defineProperty(globalThis.list[1], "late", { value: "own" });
console.log(read(globalThis.list[0]), tested(globalThis.list[1]), globalThis.list[1].late);
