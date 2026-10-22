// What a built-in calls of what it was handed is taken in two copies deep, where it is small. Sizes, and what a callback calls itself, go by every copy.
//
// A small callback comes along with the copy of the function that wrote it.
// IR= 0 copiesSmallCallback CallDirect \(v\d+, v\d+\) function=f\d+
// A large one stays a call there: forEach calls it in two places. So it does where the function that wrote it stands alone: the limit is that of a copy.
// IR= 2 copiesLargeCallback CallDirect \(v\d+, v\d+\) function=f\d+
// IR= 2 sumOfLarge CallDirect \(v\d+, v\d+\) function=f\d+
// What a small callback calls is three copies deep: the callback is taken in, in two places of each of two copies, and what it calls, which takes three arguments, stays a call in each.
// IR= 0 copiesCallbackThatCalls CallDirect \(v\d+, v\d+\) function=f\d+
// IR= 4 copiesCallbackThatCalls CallDirect \(v\d+, v\d+, v\d+\) function=f\d+
declare const console: any;

function sumOfSmall(numbers: number[]): number {
    let sum = 0;
    numbers.forEach(number => {
        sum += number;
    });
    return sum;
}

function copiesSmallCallback(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        total += sumOfSmall(numbers);
        if (rounds < 0) total += sumOfSmall(numbers);
    }
    return total;
}

function sumOfLarge(numbers: number[]): number {
    let sum = 0;
    numbers.forEach(number => {
        let scaled = number * 1.5 + 1;
        if (scaled > 10) scaled = Math.sqrt(scaled) + Math.abs(scaled - 3) + Math.floor(scaled / 7);
        if (scaled < 2) scaled = scaled * scaled - Math.ceil(scaled) + Math.round(scaled * 3);
        sum += scaled > 5 ? scaled - 5 : scaled + 5;
    });
    return sum;
}

function copiesLargeCallback(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) total += sumOfLarge(numbers);
    return total;
}

function bump(value: number, by: number, most: number): number {
    if (value > most) return value - by;
    return value * value + by;
}

function sumOfBumped(numbers: number[]): number {
    let sum = 0;
    numbers.forEach(number => {
        sum += bump(number, 2, 400);
    });
    return sum;
}

function copiesCallbackThatCalls(numbers: number[], rounds: number): number {
    let total = 0;
    for (let round = 0; round < rounds; round++) {
        total += sumOfBumped(numbers);
        if (rounds < 0) total += sumOfBumped(numbers);
    }
    return total;
}

const numbers: number[] = [];
for (let i = 0; i < 50; i++) numbers.push(((i * 7919) % 31) * 0.5);
console.log(copiesSmallCallback(numbers, 3), copiesLargeCallback(numbers, 3), sumOfLarge(numbers), copiesCallbackThatCalls(numbers, 3), bump(1, 2, 3) + bump(3, 4, 5) + bump(5, 6, 7) + bump(7, 8, 9));
export {};
