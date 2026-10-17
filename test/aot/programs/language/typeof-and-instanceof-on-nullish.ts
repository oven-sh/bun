declare const console: { log(...values: unknown[]): void };
interface Leaf { kind: "leaf"; size: number }
interface Pair { kind: "pair"; left: Tree; right: Tree }
type Tree = Leaf | Pair;
class Box { constructor(public held: number) { } get twice(): number { return this.held * 2; } }
class Crate extends Box { constructor(held: number, public lid: boolean) { super(held); } }
function sizeOf(tree: Tree): number { return tree.kind === "leaf" ? tree.size : sizeOf(tree.left) + sizeOf(tree.right); }
function heldBy(box: Box): number { return box.held; }
function hasLid(box: Box): boolean { return box instanceof Crate ? box.lid : false; }
function lengthOf(text: string): number { return text.length; }
function firstOf(list: number[]): number { return list[0]; }
function twiceOf(box: Box): number { return box.twice; }
function attempt(name: string, run: () => unknown): void {
    try {
        console.log(name, run());
    } catch (error) {
        console.log(name, "threw", error instanceof TypeError);
    }
}
const nothing: any[] = [undefined, null];
const foreign: any = JSON.parse('{"kind":"leaf","size":7,"held":8,"lid":true}');
const tree: Tree = { kind: "pair", left: { kind: "leaf", size: 1 }, right: { kind: "pair", left: { kind: "leaf", size: 2 }, right: { kind: "leaf", size: 3 } } };
attempt("a tree", () => sizeOf(tree));
attempt("a foreign leaf", () => sizeOf(foreign));
attempt("a box", () => heldBy(new Box(4)) + heldBy(new Crate(5, true)) + twiceOf(new Box(6)));
attempt("a foreign box", () => heldBy(foreign));
attempt("lids", () => [hasLid(new Box(1)), hasLid(new Crate(1, true)), hasLid(foreign)].join());
attempt("text", () => lengthOf("four") + firstOf([9]));
for (const nil of nothing) {
    attempt("no tree", () => sizeOf(nil));
    attempt("half a tree", () => sizeOf({ kind: "pair", left: { kind: "leaf", size: 1 }, right: nil }));
    attempt("no box", () => heldBy(nil));
    attempt("no box to double", () => twiceOf(nil));
    attempt("no lid", () => hasLid(nil));
    attempt("no text", () => lengthOf(nil));
    attempt("no list", () => firstOf(nil));
}
