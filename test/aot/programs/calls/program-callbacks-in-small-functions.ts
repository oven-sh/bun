function each(values: number[], visit: (value: number, index: number) => void): void {
    for (let i = 0; i < values.length; i++) visit(values[i], i);
}

function eachTwice(values: number[], visit: (value: number, index: number) => void): void {
    each(values, visit);
    each(values, visit);
}

function fold<T>(values: number[], start: T, step: (soFar: T, value: number) => T): T {
    let soFar = start;
    for (const value of values) soFar = step(soFar, value);
    return soFar;
}

function sumOf(values: number[]): number {
    let sum = 0;
    each(values, value => {
        sum += value;
    });
    return sum;
}

function sumOfTwice(values: number[]): number {
    let sum = 0;
    eachTwice(values, (value, index) => {
        sum += value * (index + 1);
    });
    return sum;
}

function joined(values: number[]): string {
    return fold(values, "", (soFar, value) => soFar + value + ";");
}

function sumUntil(values: number[], limit: number): string {
    let sum = 0;
    try {
        each(values, value => {
            if (value > limit) throw new RangeError("over " + limit + ": " + value);
            sum += value;
        });
    } catch (error) {
        return sum + " " + (error as Error).message;
    }
    return String(sum);
}

type Tree = { value: number; children: Tree[] };

function eachChild(tree: Tree, visit: (child: Tree) => void): void {
    for (const child of tree.children) visit(child);
}

function total(tree: Tree): number {
    let sum = tree.value;
    eachChild(tree, child => {
        sum += total(child);
    });
    return sum;
}

function makeAdder(by: number): (value: number) => number {
    return value => value + by;
}

function applyAll(values: number[], change: (value: number) => number): number {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += change(values[i]);
    return sum;
}

function withAnAdderMadeElsewhere(values: number[]): number {
    return applyAll(values, makeAdder(10)) + applyAll(values, makeAdder(0.5));
}

function keptAndCalledLater(values: number[]): number {
    const kept: (() => number)[] = [];
    each(values, value => {
        kept.push(() => value * 2);
    });
    let sum = 0;
    for (const call of kept) sum += call();
    return sum;
}

function nested(rows: number[][]): number {
    let sum = 0;
    for (const row of rows) {
        each(row, value => {
            each(row, other => {
                sum += value * other;
            });
        });
    }
    return sum;
}

const values: number[] = [];
for (let i = 0; i < 12; i++) values.push(i * 0.5);
let all = 0;
for (let round = 0; round < 3; round++) {
    all += sumOf(values) + sumOfTwice(values) + withAnAdderMadeElsewhere(values);
    if (round > 5) all += sumOf(values) + sumOfTwice(values);
}
console.log(all, joined(values), sumUntil(values, 100), sumUntil(values, 3));
console.log(total({ value: 1, children: [{ value: 2, children: [] }, { value: 3, children: [{ value: 4, children: [] }] }] }));
console.log(keptAndCalledLater(values), nested([[1, 2], [], [3]]), sumOf([]), joined([]));
