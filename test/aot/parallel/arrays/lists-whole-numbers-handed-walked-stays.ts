// Walks lists of whole numbers that are handed in: parsed, with holes, with elements and accessors above them, frozen, grown while they are walked. Beside them a list that only this file makes is read by index.
const written = [3, 5, 7];
function sumOfWritten(): number {
    let total = 0;
    for (let index = 0; index < written.length; index++) total += written[index];
    return total;
}
function walk(list: number[]): number {
    let total = 0;
    for (const value of list) total += value;
    return total;
}
function firstTwo(list: number[]): number {
    const [first, second] = list;
    return first * 10 + second;
}
function walkAndGrow(list: number[]): number {
    let total = 0;
    for (const value of list) {
        if (list.length < 6) list.push(value + 0.5);
        total += value;
    }
    return total;
}

const parsed = JSON.parse("[1,2,3,4]") as number[];
const holed = JSON.parse("[1,2,3,4]") as number[];
delete holed[1];
const above = JSON.parse("[10,20,30,40]") as number[];
const inherits = JSON.parse("[1,2,3,4]") as number[];
delete inherits[2];
Object.setPrototypeOf(inherits, above);
let reads = 0;
const computes = JSON.parse("[1,2,3,4]") as number[];
delete computes[0];
Object.setPrototypeOf(computes, Object.create(Array.prototype, { 0: { get() { reads++; return 100; } } }));
const frozen = Object.freeze(JSON.parse("[6,7,8]") as number[]) as number[];
const mixed = JSON.parse('[1,"2",3]') as number[];

let total = 0;
for (let round = 0; round < 2000; round++) total += walk(parsed) + firstTwo(parsed) + sumOfWritten();
console.log(total, parsed, written);
for (const list of [holed, inherits, computes, frozen, mixed, above]) console.log(walk(list), firstTwo(list), list.length, Object.keys(list).join());
console.log(reads, walk(computes), reads);
console.log(walkAndGrow(JSON.parse("[1,2,3]")), walkAndGrow(parsed), parsed);
console.log(sumOfWritten(), written[0] + written[2], written);
