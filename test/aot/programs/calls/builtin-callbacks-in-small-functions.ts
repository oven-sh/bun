function sumWithForEach(numbers: number[]): number {
    let sum = 0;
    numbers.forEach(number => {
        sum += number;
    });
    return sum;
}

function sortedCopyOf(numbers: number[]): number[] {
    const sorted = numbers.slice();
    sorted.sort((a, b) => a - b);
    return sorted;
}

function sortedByAnswersOfOddTypes(values: number[], kind: number): number[] {
    const sorted = values.slice();
    sorted.sort((a, b): any => {
        if (kind === 0) return String(a - b);
        if (kind === 1) return { valueOf() { return a - b; } };
        if (kind === 2) return undefined;
        if (kind === 3) return null;
        return a === b ? -0 : a < b ? -Infinity : Infinity;
    });
    return sorted;
}

function doubled(numbers: number[]): number[] {
    return numbers.map(number => number * 2);
}

function evens(numbers: number[]): number[] {
    return numbers.filter(number => number % 2 === 0);
}

function product(numbers: number[]): number {
    return numbers.reduce((soFar, number) => soFar * (number + 1), 1);
}

function firstOver(numbers: number[], limit: number): number | undefined {
    return numbers.find(number => number > limit);
}

function sumUntil(numbers: number[], limit: number): string {
    let sum = 0;
    try {
        numbers.forEach(number => {
            if (number > limit) throw new RangeError("over " + limit + " at " + number);
            sum += number;
        });
    } catch (error) {
        return sum + " " + (error as Error).message;
    }
    return String(sum);
}

function sumWhileTheArrayChanges(numbers: number[]): string {
    let sum = 0, turns = 0;
    numbers.forEach((number, index) => {
        turns++;
        sum += number;
        if (index === 1) numbers.push(100);
        if (index === 2) numbers.length = 4;
    });
    return sum + " " + turns + " " + numbers.length;
}

function nested(rows: number[][]): number {
    let sum = 0;
    rows.forEach(row => {
        row.forEach(cell => {
            sum += cell;
        });
    });
    return sum;
}

function keysOf(map: Map<string, number>): string {
    let keys = "";
    map.forEach((value, key) => {
        keys += key + value;
    });
    return keys;
}

const numbers: number[] = [];
for (let i = 0; i < 20; i++) numbers.push((i * 7919) % 31);
let total = 0;
for (let round = 0; round < 3; round++) {
    total += sumWithForEach(numbers) + sortedCopyOf(numbers)[round] + doubled(numbers)[round] + evens(numbers).length + (firstOver(numbers, 20 + round) ?? -1);
    if (round > 5) total += sumWithForEach(numbers) + sortedCopyOf(numbers)[0];
}
console.log(total, product([1, 2, 3]), sortedCopyOf(numbers).join());
console.log(sumUntil(numbers, 100), sumUntil(numbers, 25), sumWhileTheArrayChanges([1, 2, 3, 4, 5, 6]));
console.log(nested([[1, 2], [], [3, 4, 5]]), keysOf(new Map([["a", 1], ["b", 2]])));
for (let kind = 0; kind < 5; kind++) console.log(kind, sortedByAnswersOfOddTypes([3, 1, 2, 5, 4, 1], kind).join());
console.log(sumWithForEach([]), sortedCopyOf([]).length, sortedCopyOf([2, 1]).join(), doubled([0.5]).join());
