// A closure that has got a property, another prototype or another level of integrity, or whose name was read twice, is still a closure of its function:
// a call that expects the function, a call that chooses among a closed set of functions and a test for a function type all treat it as before.
type Unary = (a: number) => number;
const lines: string[] = [];
function show(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }

function makeAdder(step: number): Unary { return a => a + step; }
function makeScaler(factor: number): Unary { return a => a * factor; }
function makeNegator(): Unary { return a => -a; }
function makeSquare(): Unary { return a => a * a; }

const changes: ((f: any) => void)[] = [
    f => {},
    f => { f.label = "labelled"; },
    f => { Object.setPrototypeOf(f, { inherited: 1 }); },
    f => { Object.freeze(f); },
    f => { Object.preventExtensions(f); },
    f => { f.name; f.name; f.name; },
    f => { Object.defineProperty(f, "name", { value: "renamed" }); },
    f => { Object.keys(f); Object.getOwnPropertyNames(f); },
    f => { delete f.length; },
    f => { f[0] = "element"; },
];

// The set of callees is closed: nobody else gets hold of these four.
function chooseAmongFour(f: Unary, a: number): number { return f(a); }
function closedSet(): void {
    for (let change = 0; change < changes.length; change++) {
        const four: Unary[] = [makeAdder(1), makeScaler(2), makeNegator(), makeSquare()];
        for (const f of four) changes[change](f);
        let sum = 0;
        for (let round = 0; round < 40; round++) sum += chooseAmongFour(four[round & 3], round);
        show("closed set, change " + change, sum);
    }
}

// The holder comes from code nobody sees, so the callee is only expected.
const held: { f: Unary }[] = JSON.parse('[{"f":null},{"f":null},{"f":null},{"f":null}]');
function callHeld(holder: { f: Unary }, a: number): number { return holder.f(a); }
function expectedCallee(): void {
    for (let change = 0; change < changes.length; change++) {
        held[0].f = makeAdder(1); held[1].f = makeScaler(2); held[2].f = makeNegator(); held[3].f = makeSquare();
        for (const holder of held) changes[change](holder.f);
        let sum = 0;
        for (let round = 0; round < 40; round++) sum += callHeld(held[round & 3], round);
        show("expected callee, change " + change, sum);
    }
}

// One function arrives, changed or not.
function callOne(f: Unary, a: number): number { return f(a) + 1; }
function oneCallee(): void {
    for (let change = 0; change < changes.length; change++) {
        const f = makeAdder(change);
        let sum = 0;
        for (let round = 0; round < 20; round++) { if (round === 10) changes[change](f); sum += callOne(f, round); }
        show("one callee, changed in the middle, change " + change, sum);
    }
}

// What is no closure of the program, where a closure is expected.
class Counter { step = 3; add(a: number): number { return a + this.step; } static twice(a: number): number { return a * 2; } }
function callAnything(f: any, a: number): string {
    try { return String(f(a)); } catch (error) { return (error as Error).constructor.name; }
}
function otherCallees(): void {
    const counter = new Counter();
    const values: [string, unknown][] = [
        ["bound method", counter.add.bind(counter)],
        ["bound with an argument", ((a: number, b: number) => a - b).bind(null, 100)],
        ["bound twice", counter.add.bind(counter).bind(null)],
        ["static method", Counter.twice],
        ["class", Counter],
        ["host function", Math.abs],
        ["proxy of a closure", new Proxy(makeAdder(5), {})],
        ["async closure", async (a: number) => a],
        ["generator function", function* (a: number) { yield a; }],
        ["object", { call: 1 }],
        ["array", [1]],
        ["string", "text"],
        ["symbol", Symbol("s")],
        ["bigint", 12345678901234567890123n],
        ["small bigint", 1n],
        ["number", 1.5],
        ["undefined", undefined],
        ["null", null],
    ];
    for (const [label, value] of values) {
        for (let round = 0; round < 3; round++) show("called: " + label, callAnything(value, -7).replace(/\[object (\w+)\]/, "$1"));
        show("typeof " + label, typeof value);
    }
}

// Fewer and more arguments than parameters.
function three(a?: number, b?: number, c?: number): string { return a + "," + b + "," + c; }
function rest(...all: number[]): string { return all.length + ":" + all.join("+"); }
function counted(this: unknown): number { return arguments.length; }
function argumentCounts(): void {
    const functions: any[] = JSON.parse("[]"); functions.push(three, rest, counted);
    for (const f of functions) {
        show("no argument", f()); show("one", f(1)); show("two", f(1, 2)); show("three", f(1, 2, 3)); show("four", f(1, 2, 3, 4));
        show("eight", f(1, 2, 3, 4, 5, 6, 7, 8));
    }
}

// A function type admits every function and nothing else.
function takesFunction(f: Unary): string { return typeof f; }
function functionTypes(): void {
    const changed = makeAdder(1); (changed as any).label = 1;
    const values: any[] = JSON.parse("[]"); values.push(makeAdder(1), changed, Math.abs, Counter, new Counter().add.bind(null), new Proxy(makeAdder(1), {}));
    for (const value of values) show("handed to a function type", takesFunction(value));
}

closedSet(); expectedCallee(); oneCallee(); otherCallees(); argumentCounts(); functionTypes();
console.log(lines.join("\n"));
