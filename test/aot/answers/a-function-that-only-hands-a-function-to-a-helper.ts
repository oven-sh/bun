// answers: without-library
// # `function combinedFlags(node) { return combined(node, flagsOf); }`: all that it does is to hand a function of the program to a helper that only calls it: the program's own version of the helper for that function.
// # f1 = combined, f2 = flagsOf, f3 = kindOf, f4 = combinedFlags, f5 = combinedKinds, f6 = both, f7 = inTurns, f8 = combinedSums
// # In its own body the helper is copied, and no call by value is left.
// # RUN(VERSION): walk f4 mechanisms=all
// # VERSION-LABEL: code f4:Body
// # VERSION: callee=f1
// # VERSION-NOT: = Call v
// # Outside of loops it is called where it is written: copied, it would be a call of the one body that the helper has for all.
// # RUN(CALLER): walk f6 mechanisms=all
// # CALLER-LABEL: code f6:Body
// # CALLER: CallDirect {{*}} function=f4
// # CALLER: CallDirect {{*}} function=f5
// # CALLER-NOT: function=f1
// # In a loop both are copied, as before.
// # RUN(TURNS): walk f7 mechanisms=all
// # TURNS-LABEL: code f7:Body
// # TURNS-NOT: function=f4
// # TURNS-NOT: = Call v
// # A function that is written in place: the copy takes it, and no closure is made.
// # RUN(INPLACE): walk f8 mechanisms=all
// # INPLACE-LABEL: code f8:Body
// # INPLACE: callee=f1
// # INPLACE-NOT: = NewClosure
// # INPLACE-NOT: = Call v
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
type Item = { flags: number; kind: number; parent: Item | undefined };
function combined(node: Item, read: (n: Item) => number): number { let flags = read(node); if (node.kind === 1 && node.parent) { node = node.parent; flags |= read(node); } if (node.kind === 2 && node.parent) { node = node.parent; flags |= read(node); } return flags; }
function flagsOf(node: Item): number { return node.flags; }
function kindOf(node: Item): number { return node.kind; }
function combinedFlags(node: Item): number { return combined(node, flagsOf); }
function combinedKinds(node: Item): number { return combined(node, kindOf); }
function both(node: Item): number { return combinedFlags(node) * 100 + combinedKinds(node); }
function inTurns(nodes: Item[]): number { let sum = 0; for (let i = 0; i < nodes.length; i++) sum += combinedFlags(nodes[i]); return sum; }
function combinedSums(node: Item, more: number): number { return combined(node, (n: Item): number => n.flags + more); }
const root: Item = { flags: 1, kind: 0, parent: undefined };
const two: Item = { flags: 2, kind: 2, parent: root };
const one: Item = { flags: 4, kind: 1, parent: two };
report(both(root));
report(both(two));
report(both(one));
report(inTurns([root, two, one]));
report(combinedSums(one, 8));
report("end");
