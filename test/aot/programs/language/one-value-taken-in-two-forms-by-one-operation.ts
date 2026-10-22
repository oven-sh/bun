// One operation takes one value twice, and each place wants it in a form of its own: an index as a machine integer and the same number as the element, a cell as the owner and as what is stored.
declare const console: { log(...values: unknown[]): void };

function indexIsElement(length: number): unknown[] {
    const list: unknown[] = [];
    for (let i = 0; i < length; i++) list[i] = i;
    return list;
}

function indexIsElementOfNumbers(length: number): number[] {
    const list: number[] = [0.5];
    for (let i = 1; i < length; i++) list[i] = i;
    return list;
}

class Node {
    self: Node | undefined = undefined;
    next: unknown = undefined;
    constructor(public id: number) { }
}

function pointsAtItself(id: number): Node {
    const node = new Node(id);
    node.self = node;
    node.next = node;
    return node;
}

function both(a: number, b: unknown): string { return typeof a + ":" + a + " " + typeof b + ":" + String(b); }
function passedTwice(value: number): string { return both(value, value); }
function sumWithItself(value: number): unknown[] { return [value + value, value * value, value === value, [value, value]]; }
function keyIsValue(map: Map<unknown, unknown>, n: number): void { map.set(n, n); }
function charAndIndex(text: string, i: number): unknown[] { return [text.charCodeAt(i), i, text[i], text.slice(i, i)]; }

console.log(JSON.stringify(indexIsElement(5)), JSON.stringify(indexIsElementOfNumbers(4)));
const node = pointsAtItself(7);
console.log(node.self === node, node.next === node, node.self!.id);
console.log(passedTwice(3), passedTwice(2.5), passedTwice(-0), passedTwice(NaN), passedTwice(2 ** 40));
console.log(JSON.stringify(sumWithItself(21)), JSON.stringify(sumWithItself(0.25)), JSON.stringify(sumWithItself(2 ** 31)));
const map = new Map<unknown, unknown>();
for (let n = 0; n < 3; n++) keyIsValue(map, n + 0.5 * (n & 1));
console.log(JSON.stringify([...map]));
console.log(JSON.stringify(charAndIndex("forms", 2)), JSON.stringify(charAndIndex("forms", 9)));
