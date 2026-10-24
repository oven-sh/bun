// An array pattern takes one step of the array's iterator for each element. Where nothing between two steps can change the array a step is the read of an element;
// here something stands between them: the test of a written element type, a default, a target that is a property, a variable or an element of the same array, a nested pattern.
// Some of it leaves the array alone and some makes it longer, shorter, sparse or no plain array at all.
const lines: string[] = [];
function note(label: string, ...values: unknown[]): void {
    lines.push(label + ": " + values.map(value => (value === undefined ? "undefined" : JSON.stringify(value))).join(" "));
}
const hidden = new Function("v", "return v" + String(lines.length).slice(1)) as <V>(v: V) => V;

function typedElements(list: number[]): void {
    const [first, second, third] = list;
    note("typed", first, second, third);
}
typedElements(hidden([1, 2, 3]));
typedElements(hidden([1]));
typedElements(hidden([]));
typedElements(hidden([, 2] as number[]));

let calls = 0;
function three(): number {
    calls++;
    return 3;
}
function defaultLeavesArrayAlone(list: (number | undefined)[]): void {
    const [a = three(), b = three(), c = three()] = list;
    note("default", a, b, c, calls);
}
defaultLeavesArrayAlone(hidden([1, undefined]));
defaultLeavesArrayAlone(hidden([]));

function defaultGrowsArray(list: (number | undefined)[]): void {
    const [a = list.push(7, 8, 9), b, c, d] = list;
    note("default grows", a, b, c, d, list.length);
}
defaultGrowsArray(hidden([undefined]));
defaultGrowsArray(hidden([]));
defaultGrowsArray(hidden([1]));

function defaultShrinksArray(list: (number | undefined)[]): void {
    const [a = (list.length = 1), b, c] = list;
    note("default shrinks", a, b, c, list.length);
}
defaultShrinksArray(hidden([undefined, 2, 3]));
defaultShrinksArray(hidden([1, 2, 3]));

function stepPastTheEndStaysDone(list: (number | undefined)[]): void {
    const [a, b = list.push(5, 6, 7), c, d] = list;
    note("done stays done", a, b, c, d, list.length);
}
stepPastTheEndStaysDone(hidden([1]));
stepPastTheEndStaysDone(hidden([1, undefined]));

const record = hidden({ p: 0, q: 0 });
function propertyTargets(list: number[]): void {
    [record.p, record.q] = list;
    note("properties", record.p, record.q);
}
propertyTargets(hidden([4, 5]));

const growing = {
    list: hidden([1, 2] as number[]),
    set p(value: number) {
        this.list.unshift(value * 10);
    },
    q: 0,
};
function setterTargetChangesArray(): void {
    [growing.p, growing.q] = growing.list;
    note("setter", growing.q, growing.list);
}
setterTargetChangesArray();

function ownElementsAsTargets(list: number[]): void {
    [list[1], list[0]] = list;
    note("own elements", list);
    [list[3], list[2]] = list;
    note("own elements past the end", list);
}
ownElementsAsTargets(hidden([1, 2]));

function swap(list: number[], i: number, j: number): void {
    [list[i], list[j]] = [list[j], list[i]];
}
const swapped = hidden([1, 2, 3]);
swap(swapped, 0, 2);
note("swap", swapped);

function nested(list: number[][]): void {
    const [[a, b], [c]] = list;
    note("nested", a, b, c);
}
nested(hidden([[1, 2], [3]]));
nested(hidden([[1], []]));

const outer: unknown[][] = hidden([[1], [2]]);
const inner = {
    *[Symbol.iterator]() {
        outer.length = 1;
        yield "inner";
    },
};
function nestedIteratorShrinksOuter(list: unknown[]): void {
    const [[a], b] = list as [Iterable<unknown>, unknown];
    note("nested shrinks", a, b);
}
outer[0] = inner as unknown as unknown[];
nestedIteratorShrinksOuter(outer);

function accessorElement(list: number[]): void {
    const [a, b] = list;
    note("accessor", a, b, list.length);
}
const withAccessor = hidden([1, 2, 3]);
Object.defineProperty(withAccessor, 0, {
    get() {
        withAccessor.length = 1;
        return 100;
    },
});
accessorElement(withAccessor);

class Reversed extends Array<number> {
    *[Symbol.iterator](): ArrayIterator<number> {
        for (let i = this.length - 1; i >= 0; i--) yield this[i];
    }
}
function subclass(list: number[]): void {
    const [a, b] = list;
    note("subclass", a, b);
}
subclass(hidden(Reversed.from([1, 2, 3])));

let closes = 0;
const ownIterator = hidden([1, 2, 3]);
(ownIterator as any)[Symbol.iterator] = function () {
    let i = 0;
    return {
        next: () => ({ done: false, value: i++ * 2 }),
        return() {
            closes++;
            return {};
        },
    };
};
subclass(ownIterator);
note("closes", closes);

subclass(hidden(Object.freeze([7, 8]) as number[]));
console.log(lines.join("\n"));
export {};
