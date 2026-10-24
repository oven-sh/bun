// A function small enough to need no frame still converts a literal string to a string: in a result, at a merge and
// in an argument of a tail call.
const opaque = new Function("value", "return value") as <T>(value: T) => T;

type Kind = "circle" | "square" | "triangle" | "";
interface Shape { kind: Kind; next: Kind | null }
type Callback = (kind: any, index?: number) => string;

function kindAsString(shape: Shape): string {
    return shape.kind;
}
function nextAsUnknown(shape: Shape): unknown {
    return shape.next;
}
function kindOrNext(shape: Shape, useNext: boolean): string | null {
    return useNext ? shape.next : shape.kind;
}
function kindOr(shape: Shape, other: string, useOther: boolean): string {
    return useOther ? other : shape.kind;
}
function passKind(kind: Kind, callback: Function): unknown {
    return callback(kind);
}
function passField(shape: Shape, callback: (kind: string) => string): string {
    return callback(shape.kind);
}
function passNext(shape: Shape, callback: (kind: unknown, index: number) => unknown): unknown {
    return callback(shape.next, 1);
}

const kinds: Kind[] = ["circle", "square", "triangle", ""];
const shapes: Shape[] = kinds.map((kind, i) => ({ kind, next: i % 2 ? null : kinds[(i + 1) % kinds.length] }));
const callbacks: Callback[] = [
    kind => `<${kind}>`,
    kind => typeof kind + String(kind).length,
    (kind, index) => `${kind}:${index}`,
];

function sumOfLengths(leaves: { kindAsString: typeof kindAsString; nextAsUnknown: typeof nextAsUnknown; kindOrNext: typeof kindOrNext; kindOr: typeof kindOr; passKind: typeof passKind; passField: typeof passField; passNext: typeof passNext }): number {
    let sum = 0;
    for (let round = 0; round < 20_000; round++) {
        const shape = shapes[round % shapes.length];
        const callback = callbacks[round % callbacks.length];
        sum += leaves.kindAsString(shape).length + String(leaves.nextAsUnknown(shape)).length + String(leaves.kindOrNext(shape, round % 3 === 0)).length;
        sum += leaves.kindOr(shape, "other", round % 5 === 0).length + String(leaves.passKind(shape.kind, callback)).length;
        sum += leaves.passField(shape, callback).length + String(leaves.passNext(shape, callback)).length;
    }
    return sum;
}

console.log(sumOfLengths({ kindAsString, nextAsUnknown, kindOrNext, kindOr, passKind, passField, passNext }));
// A callee the compiler cannot see is not inlined, so each leaf runs in a body of its own.
console.log(sumOfLengths({
    kindAsString: opaque(kindAsString),
    nextAsUnknown: opaque(nextAsUnknown),
    kindOrNext: opaque(kindOrNext),
    kindOr: opaque(kindOr),
    passKind: opaque(passKind),
    passField: opaque(passField),
    passNext: opaque(passNext),
}));

for (const shape of shapes) {
    console.log(kindAsString(shape), nextAsUnknown(shape), kindOrNext(shape, true), kindOrNext(shape, false), kindOr(shape, "other", true), kindOr(shape, "other", false));
    for (const callback of callbacks)
        console.log(passKind(shape.kind, callback), passField(shape, callback), passNext(shape, callback));
}
