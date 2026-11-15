class Knot {
    left: Knot | null = null;
    right: Knot | null = null;
    up: Knot | null = null;
    name: string;
    on: boolean = false;
    constructor(name: string) {
        this.name = name;
    }
}

function nameOf(knot: Knot | null): string {
    return knot ? knot.name : "nobody";
}

function show(knot: Knot): string {
    return knot.name + " left " + nameOf(knot.left) + " right " + nameOf(knot.right) + " up " + nameOf(knot.up) + " on " + String(knot.on);
}

function collect(): void {
    let garbage: Knot[] = [];
    for (let i = 0; i < 2000; i++)
        garbage.push(new Knot("garbage " + i));
    garbage = [];
    Bun.gc(true);
}

const outOfSight: (knot: Knot, name: string, value: unknown) => void = (0, eval)("(knot, name, value) => { knot[name] = value; }");
const readOutOfSight: (knot: Knot, name: string) => unknown = (0, eval)("(knot, name) => knot[name]");

const root = new Knot("root");
const child = new Knot("child");
const other = new Knot("other");
child.up = root;
root.left = child;
root.right = other;
other.up = root;
console.log(show(root));
console.log(show(child));
collect();

outOfSight(root, "added", "the first added");
console.log(show(root), String(readOutOfSight(root, "added")), Object.keys(root).join(","));
outOfSight(root, "addedToo", 2.5);
outOfSight(root, "addedKnot", child);
console.log(show(root), String(readOutOfSight(root, "addedToo")), nameOf(readOutOfSight(root, "addedKnot") as Knot), Object.keys(root).join(","));
collect();
console.log(show(root), String(readOutOfSight(root, "added")), String(readOutOfSight(root, "addedToo")), nameOf(readOutOfSight(root, "addedKnot") as Knot));

root.left = other;
root.right = null;
root.up = child;
root.on = true;
console.log(show(root), String(readOutOfSight(root, "added")));
outOfSight(root, "left", "a text in left");
console.log(String(readOutOfSight(root, "left")), nameOf(root.right), nameOf(root.up), String(root.on), String(readOutOfSight(root, "added")), Object.keys(root).join(","));
outOfSight(root, "left", child);
console.log(show(root), Object.keys(root).join(","));
collect();
console.log(show(root), String(readOutOfSight(root, "added")), String(readOutOfSight(root, "addedToo")));
console.log(show(child), Object.keys(child).join(","));
console.log(show(other), Object.keys(other).join(","));

const many: Knot[] = [];
for (let i = 0; i < 300; i++) {
    const knot = new Knot("knot " + i);
    knot.up = many.length ? many[many.length - 1] : null;
    knot.left = i > 1 ? many[i - 2] : null;
    knot.on = (i & 1) === 1;
    if (i % 3 === 0)
        outOfSight(knot, "extra", i);
    if (i % 7 === 0)
        outOfSight(knot, "more" + (i % 5), "more " + i);
    many.push(knot);
    if (i % 100 === 99)
        collect();
}
let sum = 0;
for (const knot of many)
    sum += knot.name.length + nameOf(knot.up).length + nameOf(knot.left).length + nameOf(knot.right).length + (knot.on ? 1 : 0) + Number(readOutOfSight(knot, "extra") ?? 0) + Object.keys(knot).length;
console.log(String(sum));
