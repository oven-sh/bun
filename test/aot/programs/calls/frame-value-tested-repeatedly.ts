type Shape = { kind: number; flags: number; width: number; height: number; name: string; parent: Shape | null };

let log = "";

function note(text: string): number {
    log += text + ";";
    return log.length;
}

function shape(kind: number, flags: number, name: string, parent: Shape | null): Shape {
    return { kind, flags, width: kind * 2, height: flags + 1, name, parent };
}

function manyTests(a: Shape, b: Shape, limit: number): number {
    const before = note(a.name);
    if (a.kind === 1)
        return before;
    if (a.flags & 4)
        return before + 1;
    if (a.width > limit)
        return before + 2;
    if (b.kind === a.kind)
        return before + 3;
    if (b.flags === a.flags)
        return before + 4;
    if (a.height === b.height)
        return before + 5;
    if (a.parent === b)
        return before + 6;
    const after = note(b.name);
    if (a.kind === 7)
        return after;
    if (b.width + a.width > limit)
        return after + a.height;
    return after + b.height + a.kind;
}

function changedBetweenTests(a: Shape, b: Shape): number {
    let current = a;
    const first = note(current.name);
    if (current.kind === 1)
        return first;
    if (current.flags & 1)
        current = b;
    if (current.kind === 2)
        return first + 1;
    if (current.width > 5)
        current = current.parent ?? a;
    if (current.kind === 3)
        return first + 2;
    return note(current.name) + current.kind;
}

function testsInALoop(list: Shape[], wanted: Shape): number {
    let found = 0;
    const start = note(wanted.name);
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.kind !== wanted.kind)
            continue;
        if (item.flags !== wanted.flags)
            continue;
        if (item.width < wanted.width)
            continue;
        if (item.name === wanted.name)
            found += note(item.name);
        found++;
    }
    return found + start;
}

function sideWaysOut(a: Shape, b: Shape, mode: number): string {
    const n = note("side");
    if (mode === 0)
        return a.name + n;
    if (mode === 1)
        return b.name + a.name;
    if (mode === 2)
        return String(note(a.name) + a.kind) + b.name;
    if (mode === 3)
        return String(a.flags) + note(b.name) + a.name + b.kind;
    return a.name + b.name + a.kind + b.flags + n;
}

function numbersToo(x: number, y: number, z: number): number {
    const n = note("numbers");
    if (x > 10)
        return n;
    if (x + y > 10)
        return n + x;
    if (y * z > x)
        return n + y;
    if (z - x > y)
        return n + z;
    return x + y + z + note("end");
}

const root = shape(9, 0, "root", null);
const shapes = [shape(1, 0, "one", root), shape(2, 4, "two", root), shape(3, 1, "three", root), shape(4, 2, "four", null), shape(5, 2, "five", root), shape(7, 8, "seven", root), shape(3, 1, "three", null)];
let total = 0;
for (const a of shapes) {
    for (const b of shapes)
        total += manyTests(a, b, 9) * 3 + changedBetweenTests(a, b);
}
console.log(total, log.length);
log = "";
console.log(testsInALoop(shapes, shapes[2]), testsInALoop(shapes, root), log);
for (let mode = 0; mode < 5; mode++)
    console.log(sideWaysOut(shapes[1], shapes[4], mode));
console.log(numbersToo(11, 0, 0), numbersToo(5, 6, 0), numbersToo(1, 2, 3), numbersToo(1, 0.5, 2), numbersToo(1, 1, 1));
console.log(manyTests(shape(6, 0, "child", shapes[3]), shapes[3], 100), log.length);
