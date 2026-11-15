// `isListed(shape.tag)`: the read is a guess, and the callee is copied in line: the typed run has the copy, with the argument as the run knows it, and the closed arm calls.
// The function and the objects are handed to unseen code, so nothing is proven of the parameter; the odd object has no layout of the program.
// THE DEED: the field of another object holds 1.5; the copy compares
const enum Tag { Least = -2147483648, MinusOne = -1, Zero, One, Two, Three, Four, Five, Seven = 7, Nine = 9, Far = 33, Greatest = 2147483647 }
class Shape {
    tag: Tag;
    weight: number;
    next: Shape | undefined;
    constructor(tag: Tag, weight: number) {
        this.tag = tag;
        this.weight = weight;
        this.next = undefined;
    }
}
const said: string[] = [];
function isSmall(tag: Tag): boolean {
    return tag === Tag.Zero || tag === Tag.One || tag < Tag.MinusOne;
}
function pick(shape: Shape): string {
    return isSmall(shape.tag) ? "small" : "large";
}
(globalThis as any).picker = pick;
const shapes: Shape[] = [];
for (let tag = -3; tag < 12; tag++) {
    shapes.push(new Shape(tag, tag * 2));
    if (tag > 0)
        shapes[shapes.length - 1].next = shapes[shapes.length - 2];
}
(globalThis as any).kept = shapes;
const odd: any = Object.fromEntries([["tag", 1.5], ["weight", 1.5], ["next", Object.fromEntries([["tag", 1.5]])]]);
for (let turn = 0; turn < 4; turn++) {
    for (const shape of shapes)
        said.push(pick(shape));
    said.push("| " + (globalThis as any).picker(odd) + " |");
}
console.log(said.join(","));
