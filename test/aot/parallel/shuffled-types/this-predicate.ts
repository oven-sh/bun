// A `this is` predicate says derived class of an object of the base. The types that the compiler expects are shuffled: they may cost time and decide nothing.
// Flags: --aot-testing=ShuffleExpectedTypes
function show(...values: unknown[]) { console.log(JSON.stringify(values, (k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v))); }
class Node1 { kind = "node"; isLeaf(): this is Leaf { return true; } } class Leaf extends Node1 { value = 7; }
function f21(n: Node1): unknown { return n.isLeaf() ? n.value + 1 : "no"; }
for (let i = 0; i < 30; i++) f21(new Leaf()); show(f21(new Node1()));
export {};
