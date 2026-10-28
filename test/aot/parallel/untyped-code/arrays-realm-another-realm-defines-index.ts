// Another realm defines accessors for indices on its own prototypes while a prototype object of this realm inherits from them. The arrays of this realm do not inherit from that realm and stay as they are.
import vm from "node:vm";
type Mixed = number | string | null;
const source: number[] = [4.5, 5.5, 6.5, 7.5];
function rest(...xs: number[]): number[] { return xs; }
const kinds: [string, (n: number) => unknown[]][] = [
    ["doubles", n => { const a: number[] = [n + 0.5, n + 1.5, n + 2.5]; return a; }],
    ["constants", _ => { const a: number[] = [1, 2, 3]; return a; }],
    ["constant values", _ => { const a: Mixed[] = ["a", null, "b"]; return a; }],
    ["pushed to", n => { const a: number[] = []; for (let i = 0; i < 9; i++) a.push(n + i); return a; }],
    ["values pushed to", n => { const a: Mixed[] = []; for (let i = 0; i < 9; i++) a.push(i & 1 ? "s" : n); return a; }],
    ["spread", n => [n, ...source]], ["slice", _ => source.slice(1)], ["map", n => source.map(x => x + n)], ["concat", n => source.concat([n])],
    ["Array.of", n => Array.of(n, n + 1)], ["Array.from", _ => Array.from(source)], ["new Array(9)", _ => new Array(9)],
    ["rest", n => rest(n, n + 1, n + 2)], ["keys", _ => Object.keys({ a: 1, b: 2 })], ["split", _ => "a,b,c".split(",")], ["match", _ => "xaby".match(/a(b)/) as unknown[]],
];
function show(when: string): void {
    for (const [name, make] of kinds) console.log(when, name + ":", JSON.stringify(make(2)), 7 in make(3), String(make(4)[7]));
}
function many(k: number): number {
    let s = 0;
    for (const [, make] of kinds) for (let i = 0; i < k; i++) s += make(i).length;
    return s;
}
const definition = `{ get() { return "theirs"; }, set(value) {}, configurable: true }`;
const ways: [string, (context: object, theirs: any) => void][] = [
    ["this realm defines it on their Object.prototype", (_, theirs) => { Object.defineProperty(theirs.Object.prototype, "7", { get() { return "theirs"; }, set(_value) {}, configurable: true }); }],
    ["this realm defines it on their Array.prototype", (_, theirs) => { Object.defineProperty(theirs.Array.prototype, "7", { get() { return "theirs"; }, set(_value) {}, configurable: true }); }],
    ["their code defines it on both", context => { vm.runInContext(`Object.defineProperty(Object.prototype, "7", ${definition}); Object.defineProperty(Array.prototype, "7", ${definition});`, context); }],
    ["their code makes an index of Object.prototype read-only", context => { vm.runInContext(`Object.defineProperty(Object.prototype, "7", { value: "theirs", writable: false, configurable: true });`, context); }],
];
console.log(many(300));
show("at first,");
const kept: unknown[] = [];
for (const [way, define] of ways) {
    const context = vm.createContext({});
    const theirs: any = vm.runInContext("({ Object, Array })", context);
    const withElements = Object.create(theirs.Object.prototype);
    withElements[0] = 1;
    const emptied: any = {};
    kept.push(Object.create(withElements), Object.create(emptied));
    Object.setPrototypeOf(emptied, theirs.Object.prototype);
    define(context, theirs);
    console.log(way + ":", String(withElements[7]), String(emptied[7]), String((kept.at(-1) as any)[7]), String(vm.runInContext("[][7]", context)));
    show(way + ",");
    console.log(many(20000));
}
show("at last,");
