function check(value: number): number {
    if (value < 0) {
        let scaled = value;
        for (let i = 1; i <= 3; i++) scaled = scaled * 1.5 + i + Math.sqrt(scaled * scaled + i) + Math.abs(scaled - i) + Math.floor(scaled / i);
        return Math.round(scaled);
    }
    if (value % 3 === 0) throw new RangeError("a multiple of three: " + value);
    return value;
}

function countOf(values: number[]): string {
    let sum = 0, caught = "";
    for (let i = 0; i < values.length; i++) {
        try {
            sum += check(values[i]);
        } catch (error) {
            caught += (error as Error).name + " " + (error as Error).message.length + ",";
        } finally {
            sum += 0.5;
        }
    }
    return sum + " " + caught;
}

function firstThatThrows(value: number): number {
    if (value > 4) throw value;
    return value * 2;
}

function sumUntilItThrows(values: number[]): number {
    let sum = 0;
    for (const value of values) sum += firstThatThrows(value);
    return sum;
}

class Counter {
    count = 0;
    bump(by: number): number {
        if (by > 100) throw new Error("too much at " + this.count);
        this.count += by;
        return this.count;
    }
}

function bumpAll(counter: Counter, steps: number[]): number {
    let last = 0;
    for (let i = 0; i < steps.length; i++) last = counter.bump(steps[i]);
    return last;
}

function calledOnceOutsideALoop(value: number): number {
    if (value > 10) throw new Error("over ten");
    return value + 1;
}

function small(value: number): number {
    return calledOnceOutsideALoop(value) * 2;
}

const values = [1, 2, 3, -4, 5, 6, 7, -8.5, 9];
console.log(countOf(values));
for (let round = 0; round < 3; round++) console.log(round, countOf(values.slice(round)));
console.log(countOf([]));
try {
    console.log(sumUntilItThrows([1, 2, 3]));
    console.log(sumUntilItThrows([1, 2, 3, 4, 5, 6]));
} catch (thrown) {
    console.log("thrown", thrown);
}
const counter = new Counter();
try {
    console.log(bumpAll(counter, [1, 2, 3]));
    console.log(bumpAll(counter, [4, 500, 6]));
} catch (error) {
    console.log((error as Error).message, counter.count);
}
try {
    console.log(small(3), small(10));
    console.log(small(11));
} catch (error) {
    console.log((error as Error).message);
}
