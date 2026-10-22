// A small function that is copied into the loop that calls it keeps what it takes in where it stands alone.
//
// The callback of a built-in or of a function of the program: its call is as deep as the place where the closure was written. What is left of forEach is its own call for the rest, which takes five arguments.
// IR= 0 copiesForEach CallDirect \(v\d+, v\d+\) function=f\d+
// IR= 0 copiesEach CallDirect
// What the copy of a built-in calls, its own helpers and what it was handed, is as deep as the call of the built-in.
// IR= 0 copiesSort CallDirect
// A closure that two functions make has no such place: handed on through a copy of a copy, its call stays a call.
// IR= 1 copiesEachWithAClosureOfTwoMakers CallDirect \(v\d+\) function=f\d+
// A function of the program is a level: what it calls from a copy of a copy stays a call.
// IR= 2 copiesTwoLevels CallDirect
// What only a loop calls moves into the loop however small the function around the loop is; outside a loop it stays a call.
// IR= 0 smallWithALoop CallDirect
// IR= 1 smallWithoutALoop CallDirect
declare const console: any;

function sumWithForEach(numbers: number[]): number {
    let sum = 0;
    numbers.forEach(number => {
        sum += number;
    });
    return sum;
}

function copiesForEach(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        total += sumWithForEach(numbers);
        if (rounds < 0) total += sumWithForEach(numbers);
    }
    return total;
}

function smallestOf(numbers: number[]): number {
    const sorted = numbers.slice();
    sorted.sort((a, b) => a - b);
    return sorted[0];
}

function copiesSort(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        total += smallestOf(numbers);
        if (rounds < 0) total += smallestOf(numbers);
    }
    return total;
}

function each(numbers: number[], visit: (number: number) => void): void {
    for (let i = 0; i < numbers.length; i++) visit(numbers[i]);
}

function sumWithEach(numbers: number[]): number {
    let sum = 0;
    each(numbers, number => {
        sum += number;
    });
    return sum;
}

function copiesEach(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        total += sumWithEach(numbers);
        if (rounds < 0) total += sumWithEach(numbers);
    }
    return total;
}

const counted = { calls: 0 };
function count(number: number): void {
    counted.calls += number > 1 ? 2 : 1;
    if (counted.calls > 1e9) counted.calls = 0;
}

function countWithEach(numbers: number[]): number {
    each(numbers, count);
    return counted.calls;
}

function alsoHandsCountOn(numbers: number[]): void {
    each(numbers, count);
}

function copiesEachWithAClosureOfTwoMakers(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) total += countWithEach(numbers);
    return total;
}

function innermost(value: number, by: number): number {
    if (value > 400) return value - by;
    return value * value + by;
}

function middle(value: number, by: number): number {
    return innermost(value, by) + innermost(by, 1) * 0 + 1;
}

function outermost(value: number, by: number): number {
    return middle(value, by) + 1;
}

function copiesTwoLevels(numbers: number[]): number {
    let total = 0;
    for (let i = 0; i < numbers.length; i++) total += outermost(numbers[i], i);
    return total;
}

function onlyTheLoopCallsIt(value: number): number {
    if (value < 0) {
        let scaled = value;
        for (let i = 1; i <= 3; i++) scaled = scaled * 1.5 + i + Math.sqrt(scaled * scaled + i) + Math.abs(scaled - i) + Math.floor(scaled / i);
        return scaled;
    }
    return value + 1;
}

function smallWithALoop(numbers: number[]): number {
    let total = 0;
    for (let i = 0; i < numbers.length; i++) total += onlyTheLoopCallsIt(numbers[i]);
    return total;
}

function calledOnceOutsideALoop(value: number): number {
    if (value < 0) {
        let scaled = value;
        for (let i = 1; i <= 3; i++) scaled = scaled * 2.5 + i + Math.sqrt(scaled * scaled + i) + Math.abs(scaled - i) + Math.floor(scaled / i);
        return scaled;
    }
    return value + 2;
}

function smallWithoutALoop(value: number): number {
    return calledOnceOutsideALoop(value) * 2;
}

const numbers: number[] = [];
for (let i = 0; i < 50; i++) numbers.push(((i * 7919) % 31) * 0.5);
alsoHandsCountOn(numbers);
console.log(copiesForEach(numbers, 3), copiesSort(numbers, 3), copiesEach(numbers, 3), copiesEachWithAClosureOfTwoMakers(numbers, 3), copiesTwoLevels(numbers), smallWithALoop(numbers), smallWithoutALoop(3), smallWithoutALoop(4));
export {};
