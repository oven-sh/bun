// Swaps and rotates elements through a list that is taken apart at once, in loops, over lists of numbers, of numbers or undefined, of texts, with holes and past the end. Reads a list that is written on the spot at a position that is computed.
function siftUp(items: number[], from: number): void {
    let at = from;
    while (at > 0) {
        const parent = (at - 1) >> 1;
        if (items[parent]! <= items[at]!) break;
        [items[parent], items[at]] = [items[at]!, items[parent]!];
        at = parent;
    }
}
function reverse(items: (number | undefined)[]): void {
    for (let low = 0, high = items.length - 1; low < high; low++, high--) [items[low], items[high]] = [items[high], items[low]];
}
function rotate(items: string[], turns: number): void {
    for (let turn = 0; turn < turns; turn++) [items[0], items[1], items[2]] = [items[1]!, items[2]!, items[0]!];
}
function divisor(first: number, second: number): number {
    let a = first;
    let b = second;
    while (b) [a, b] = [b, a % b];
    return a;
}
function swapPastTheEnd(items: number[], at: number): string {
    [items[at], items[at + 1]] = [items[at + 1]!, items[at]!];
    return JSON.stringify(items) + " " + items.length;
}
function chooseOfTwo(first: number, second: number, turn: number): number {
    return [first, second][turn & 1]!;
}
function chooseOfThree(first: number, second: number, third: number, turn: number): number | undefined {
    return [first, second, third][turn & 3];
}
function chooseBesideAHole(first: number, turn: number): number | undefined {
    return [first, , first + 1][turn % 3];
}
function chooseText(first: string, second: string, turn: number): string {
    return [first, second][turn & 1]!.toUpperCase();
}
function fewerThanAreAskedFor(value: number): string {
    let a: number | undefined = 1;
    let b: number | undefined = 2;
    let seen = "";
    for (let turn = 0; turn < 3; turn++) {
        [a, b] = [value + turn] as (number | undefined)[];
        seen += String(a) + "," + String(b) + " ";
    }
    return seen;
}
const order: string[] = [];
const watched = {
    set first(value: number) {
        order.push("first " + value);
    },
    set second(value: number) {
        order.push("second " + value);
    },
};
function storeThroughSetters(a: number, b: number): void {
    [watched.first, watched.second] = [b, a];
}

const heap: number[] = [];
for (let index = 0; index < 40; index++) {
    heap.push((index * 37) & 63);
    siftUp(heap, heap.length - 1);
}
console.log(heap.join(" "));

const maybe: (number | undefined)[] = [1, undefined, 3, 4.5, undefined, 6, 7];
for (let turn = 0; turn < 5; turn++) reverse(maybe);
console.log(JSON.stringify(maybe));
const withHole: (number | undefined)[] = [1, , 3, 4];
reverse(withHole);
console.log(JSON.stringify(withHole), 1 in withHole, 2 in withHole);

const texts = ["a", "b", "c", "d"];
rotate(texts, 7);
console.log(texts.join(""));

let sum = 0;
for (let index = 1; index < 300; index++) sum += divisor(index, 360) + divisor(index * 0.5, 7.5);
console.log(sum);

console.log(swapPastTheEnd([1, 2, 3], 2));
console.log(swapPastTheEnd([1, 2, 3], 5));

let chosen = 0;
let missing = 0;
let text = "";
for (let turn = 0; turn < 50; turn++) {
    chosen += chooseOfTwo(turn, turn * 0.25, turn);
    const ofThree = chooseOfThree(turn, -turn, 0.5, turn);
    if (ofThree === undefined) missing++;
    else chosen += ofThree;
    const besideAHole = chooseBesideAHole(turn, turn);
    if (besideAHole === undefined) missing++;
    else chosen += besideAHole;
    text += chooseText("x", "y", turn);
}
console.log(chosen, missing, text);
console.log(fewerThanAreAskedFor(5));
for (let turn = 0; turn < 3; turn++) storeThroughSetters(turn, turn + 10);
console.log(order.join(" | "));
