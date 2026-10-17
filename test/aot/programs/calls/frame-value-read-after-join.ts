type Shape = { kind: number; flags: number; width: number; height: number; name: string; parent: Shape | null };

let log = "";

function note(text: string): number {
    log += text + ";";
    return log.length;
}

function shape(kind: number, flags: number, name: string, parent: Shape | null): Shape {
    return { kind, flags, width: kind * 2, height: flags + 1, name, parent };
}

function bothArmsReadIt(a: Shape, b: Shape, limit: number): number {
    const before = note(a.name);
    let sum = before;
    if (a.kind > limit)
        sum += a.width;
    else
        sum -= a.height;
    if (a.flags & 2)
        sum += b.kind;
    else
        sum += b.flags;
    sum += a.kind * 3 + b.width;
    const after = note(b.name);
    return sum + after + a.flags + b.height;
}

function oneArmNamesNothing(a: Shape, b: Shape, limit: number): number {
    const before = note(a.name);
    let sum = before + a.kind;
    if (limit > 3)
        sum += limit;
    if (limit > 5)
        sum *= 2;
    sum += a.width;
    if (limit > 7)
        sum -= b.kind;
    return sum + a.height + note(b.name) + a.flags;
}

function oneArmCalls(a: Shape, b: Shape, limit: number): number {
    const before = note(a.name);
    let sum = before + a.kind;
    if (limit > 3)
        sum += note("in the arm");
    sum += a.width;
    if (limit > 5)
        sum += b.kind;
    else
        sum += note(b.name);
    return sum + a.height + b.flags;
}

function oneArmChangesIt(a: Shape, b: Shape, limit: number): number {
    let current = a;
    const before = note(current.name);
    let sum = before + current.kind;
    if (limit > 3)
        current = b;
    sum += current.width;
    if (limit > 5)
        current = current.parent ?? a;
    else
        sum += current.flags;
    sum += current.height;
    return sum + note(current.name) + current.kind;
}

function joinsInALoop(list: Shape[], wanted: Shape, limit: number): number {
    let sum = note(wanted.name);
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.kind > limit)
            sum += wanted.kind;
        else
            sum += wanted.flags;
        sum += wanted.width + item.height;
        if (item.flags === wanted.flags)
            sum += note(item.name);
        sum += wanted.height;
    }
    return sum;
}

function nestedJoins(a: Shape, b: Shape, c: Shape, limit: number): number {
    let sum = note(a.name) + note(b.name) + note(c.name);
    if (a.kind > limit) {
        if (b.kind > limit)
            sum += c.kind;
        else
            sum += c.flags;
        sum += a.width;
    } else {
        if (c.kind > limit)
            sum += b.width;
        sum += a.height;
    }
    sum += a.flags + b.flags + c.width;
    return sum + note("end") + a.kind + b.height + c.height;
}

const root = shape(9, 1, "root", null);
const shapes: Shape[] = [];
for (let i = 0; i < 12; i++)
    shapes.push(shape(i % 5, i % 4, "s" + i, i % 3 ? root : null));

let total = 0;
for (let limit = 0; limit < 10; limit++) {
    for (let i = 0; i < shapes.length; i++) {
        const a = shapes[i];
        const b = shapes[(i + 5) % shapes.length];
        const c = shapes[(i + 7) % shapes.length];
        total += bothArmsReadIt(a, b, limit);
        total += oneArmNamesNothing(a, b, limit);
        total += oneArmCalls(a, b, limit);
        total += oneArmChangesIt(a, b, limit);
        total += nestedJoins(a, b, c, limit);
        total %= 1000003;
    }
    total += joinsInALoop(shapes, shapes[limit], limit);
    log = log.slice(-40);
}
console.log(total, log);
