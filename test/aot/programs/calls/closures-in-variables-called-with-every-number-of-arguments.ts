// Closures with zero to six parameters, called through a variable with zero to six arguments.
type Callee = (a?: number, b?: number, c?: number, d?: number, e?: number, f?: number) => string;
const seed: number = 7;
function describe(values: Array<number | undefined>): string {
    return values.map(value => value === undefined ? "_" : String(value + seed)).join(",");
}
const callees: Callee[] = [
    () => "0:" + seed,
    a => "1:" + describe([a]),
    (a, b) => "2:" + describe([a, b]),
    (a, b, c) => "3:" + describe([a, b, c]),
    (a, b, c, d) => "4:" + describe([a, b, c, d]),
    (a, b, c, d, e) => "5:" + describe([a, b, c, d, e]),
    (a, b, c, d, e, f) => "6:" + describe([a, b, c, d, e, f]),
    (...rest) => "rest:" + describe(rest),
    (a = 40, b = a + 1) => "defaults:" + describe([a, b]),
    function (a, b) { return "arguments:" + arguments.length + ":" + describe([a, b]); },
];
function callWithEveryCount(callee: Callee): string {
    return [callee(), callee(1), callee(1, 2), callee(1, 2, 3), callee(1, 2, 3, 4), callee(1, 2, 3, 4, 5), callee(1, 2, 3, 4, 5, 6)].join(" ");
}
for (const callee of callees)
    console.log(callWithEveryCount(callee));

const holder: { run: Callee } = { run: callees[0] };
for (const callee of callees) {
    holder.run = callee;
    console.log(holder.run(), holder.run(1, 2, 3), holder.run(1, 2, 3, 4, 5, 6));
}

const tagged: Callee & { tag?: number } = (a, b) => "tagged:" + describe([a, b]);
console.log(callWithEveryCount(tagged));
tagged.tag = 1;
console.log(callWithEveryCount(tagged), tagged.tag);

class Point { constructor(public x = 1) {} }
const constructorAsCallee = Point as unknown as Callee;
try {
    console.log(constructorAsCallee(1));
} catch (error) {
    console.log("calling a class throws a TypeError:", error instanceof TypeError);
}

let depth = 0;
let descend: (n: number) => number = n => n;
descend = n => {
    depth = n;
    return descend(n + 1) + 1;
};
try {
    console.log(descend(0));
} catch (error) {
    console.log("endless recursion through a variable throws a RangeError:", error instanceof RangeError, depth > 1000);
}
