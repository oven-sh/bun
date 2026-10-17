declare const console: { log(...values: unknown[]): void };
class Item { constructor(public id: number) { } }
function runsOf(items: readonly Item[]): string {
    let result = "";
    const length = items.length;
    let i = 0;
    while (i < length) {
        const startId = items[i].id;
        let count = 1;
        while (i + count < length && items[i + count].id === startId + count) count++;
        if (result.length) result += ",";
        result += startId;
        if (count > 1) result += ":" + count;
        i += count;
    }
    return result;
}
function mirrored(items: readonly Item[]): number {
    let i = 0, total = 0;
    while (i < items.length) { let count = 1; while (items.length > count + i && items[count + i].id > 0) count++; total += count * (i + 1); i += count; }
    return total;
}
function inclusive(items: readonly Item[]): number {
    let i = 0, total = 0;
    const last = items.length - 1;
    while (i <= last) { let count = 0; while (i + count <= last && items[i + count].id % 2 === 0) count++; total += count; i += count + 1; }
    return total;
}
function negativeAddend(items: readonly Item[], back: number): number {
    let i = 2, total = 0;
    const offset = back | 0;
    while (i + offset < items.length && i < 100) { total += i; i += 3; }
    return total;
}
function fractionalBound(limit: number): number {
    let i = 0, count = 1, turns = 0;
    while (i + count < limit && turns < 50) { count++; i += count; turns++; }
    return i * 1000 + count;
}
function hugeStep(limit: number): string {
    let i = 0, step = 1, turns = 0;
    while (i + step < limit && turns < 2000) { i += step; step += step; turns++; }
    return i + " " + step + " " + turns;
}
function fractionalAddend(limit: number, addend: number): number {
    let i = 0;
    while (i + addend < limit) i++;
    return i;
}
const make = (...ids: number[]) => ids.map(id => new Item(id));
for (let round = 0; round < 2; round++) {
    console.log(runsOf(make()), "|", runsOf(make(5)), "|", runsOf(make(1, 2, 3, 7, 8, 20)), "|", runsOf(make(3, 3, 4, 5, 5.5, 6.5, -1, 0, 1)), "|", runsOf(make(NaN, NaN, 1)));
    console.log(mirrored(make(1, 2, 0, 4, 5, 6, 0, 0)), inclusive(make(2, 4, 1, 6, 3, 8, 8, 8)), inclusive(make()), mirrored(make()));
    console.log(negativeAddend(make(1, 2, 3, 4, 5, 6, 7, 8, 9), -4), negativeAddend(make(1, 2, 3), -2147483648), negativeAddend(make(1, 2, 3), 5), negativeAddend(make(1, 2, 3), 0.5));
    console.log(fractionalBound(10.5), fractionalBound(NaN), fractionalBound(Infinity), fractionalBound(-1), fractionalBound(1e300));
    console.log(hugeStep(1e30), "|", hugeStep(Infinity), "|", hugeStep(9007199254740993), "|", hugeStep(100));
    console.log(fractionalAddend(5, 0.5), fractionalAddend(5, -0.5), fractionalAddend(5, NaN), fractionalAddend(3, -2.25));
}
const many: Item[] = []; for (let i = 0; i < 5000; i++) many.push(new Item(i % 7 === 0 ? i * 2 : i));
console.log(runsOf(many).length, mirrored(many), inclusive(many));
