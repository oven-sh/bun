// A literal gives its object all its names at once. A loop that stores the same names one by one into an empty object ends, with the last of them, in the state that the literal made.
// That last store repeats like the others, so it is remembered like the others. What is remembered must not outlive what it rests on: another order of the names, a name more or less,
// a setter or a read-only property that appears above the target, a target that takes no more names, and more names than an object holds in its cell.
type Dictionary = Record<string, number>;
const lines: string[] = [];
// Under --aot-validate what the caches remember is compared with the objects' state at the end of each collection.
function show(title: string, object: object) {
    Bun.gc(true);
    lines.push(title + ": " + JSON.stringify(object) + " | " + Object.keys(object).join());
}

function copyByForIn(source: Dictionary): Dictionary {
    const out: Dictionary = {};
    for (const name in source) out[name] = source[name];
    return out;
}
function copyByKeys(source: Dictionary, names: string[]): Dictionary {
    const out: Dictionary = {};
    for (const name of names) out[name] = source[name];
    return out;
}
function copyOnto(target: Dictionary, source: Dictionary, names: string[]): Dictionary {
    for (const name of names) {
        try {
            target[name] = source[name];
        } catch (error) {
            lines.push("refused " + name + ": " + (error as Error).constructor.name);
        }
    }
    return target;
}

const four: Dictionary = { alpha: 1, bravo: 2, charlie: 3, delta: 4 };
let last: Dictionary = {};
for (let round = 0; round < 300; round++) last = copyByForIn(four);
show("the same names in the same order", last);
four.delta = 40;
show("the copy is an object of its own", last);
show("and its source too", four);

for (let round = 0; round < 300; round++) last = copyByKeys(four, ["alpha", "bravo", "charlie", "delta"]);
show("by a list of names", last);
for (let round = 0; round < 300; round++) last = copyByKeys(four, ["delta", "charlie", "bravo", "alpha"]);
show("in the opposite order", last);
for (let round = 0; round < 300; round++) last = copyByKeys(four, ["alpha", "bravo", "delta", "charlie"]);
show("the last two the other way round", last);
for (let round = 0; round < 300; round++) last = copyByKeys(four, ["alpha", "bravo", "charlie"]);
show("one name fewer", last);
for (let round = 0; round < 300; round++) last = copyByKeys({ ...four, echo: 5 }, ["alpha", "bravo", "charlie", "delta", "echo"]);
show("one name more", last);
for (let round = 0; round < 300; round++) last = copyByKeys(four, ["alpha", "bravo", "charlie", "delta", "delta", "alpha"]);
show("names that come twice", last);

const many: Dictionary = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18, s: 19, t: 20 };
for (let round = 0; round < 300; round++) last = copyByForIn(many);
show("more names than a cell holds", last);
let sum = 0;
for (const name in last) sum += last[name];
lines.push("their sum: " + sum);

const seven: Dictionary = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
for (let round = 0; round < 300; round++) last = copyByForIn(seven);
show("seven names", last);

// The target is not empty, or not ordinary.
for (let round = 0; round < 300; round++) last = copyOnto({ zulu: 0 }, four, ["alpha", "bravo", "charlie", "delta"]);
show("behind a name of its own", last);
for (let round = 0; round < 300; round++) last = copyOnto(Object.create(null) as Dictionary, four, ["alpha", "bravo", "charlie", "delta"]);
show("without a prototype", last);
lines.push("its prototype: " + Object.getPrototypeOf(last));

const closedAfterThree = () => Object.preventExtensions(copyByKeys(four, ["alpha", "bravo", "charlie"]));
show("takes no more names", copyOnto(closedAfterThree(), four, ["delta"]));
show("frozen", copyOnto(Object.freeze(copyByKeys(four, ["alpha", "bravo", "charlie"])), four, ["charlie", "delta"]));

// What lies above the target changes while the stores are remembered.
const above: Record<string, unknown> = {};
const below = () => Object.create(above) as Dictionary;
for (let round = 0; round < 300; round++) last = copyOnto(below(), four, ["alpha", "bravo", "charlie", "delta"]);
show("below an empty object", last);
const seen: number[] = [];
Object.defineProperty(above, "delta", { set(value: number) { seen.push(value); }, get() { return -1; }, configurable: true });
for (let round = 0; round < 3; round++) last = copyOnto(below(), four, ["alpha", "bravo", "charlie", "delta"]);
show("below a setter for the last name", last);
lines.push("the setter saw " + seen.join() + "; read through the copy: " + last.delta);
Object.defineProperty(above, "delta", { value: 7, writable: false, configurable: true });
for (let round = 0; round < 2; round++) last = copyOnto(below(), four, ["alpha", "bravo", "charlie", "delta"]);
show("below a read-only property", last);
delete above.delta;
for (let round = 0; round < 300; round++) last = copyOnto(below(), four, ["alpha", "bravo", "charlie", "delta"]);
show("below an empty object again", last);

for (let round = 0; round < 300; round++) last = copyByForIn(four);

// The copies and the literal's own objects are told apart by nothing.
const literal = (): Dictionary => ({ alpha: 1, bravo: 2, charlie: 3, delta: 40 });
lines.push("as the literal: " + (JSON.stringify(last) === JSON.stringify(literal())) + " " + (Object.keys(last).join() === Object.keys(literal()).join()));
last.echo = 5;
const other = literal();
other.echo = 6;
show("each goes on by itself", last);
show("each goes on by itself", other);
delete last.bravo;
show("a name is taken out", last);
last.bravo = 22;
show("and put back", last);

console.log(lines.join("\n"));
