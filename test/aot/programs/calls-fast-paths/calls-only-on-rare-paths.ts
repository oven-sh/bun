// A large function without calls in its source: all calls in its machine code are on rarely taken paths.
// IRM= 1 CallDirect \(v[0-9]+, v[0-9]+, v[0-9]+\) function=f[0-9]+
interface Shape { kind: number; flags: number; objectFlags: number; width: number; height: number; parent: Shape | undefined; label: string }

function measure(shape: Shape, other: Shape, mask: number): number {
    let result = 0;
    if (shape.flags & 0x3C0001) result += shape.objectFlags & 0x1814000D;
    if (other.flags & 0x3C0001) result += other.objectFlags & 0x1814000D;
    if (shape.kind === 5949 || shape.kind === 5948) result ^= 0x2FF;
    if (other.kind === 5949 || other.kind === 5948) result ^= 0x2FF;
    if (shape.parent && shape.parent.flags & mask) result += shape.parent.kind * 3;
    if (other.parent && other.parent.flags & mask) result += other.parent.kind * 5;
    if (shape.width > other.width) result += 65537; else if (shape.width < other.width) result -= 65537;
    if (shape.height > other.height) result += 131071; else if (shape.height < other.height) result -= 131071;
    if (shape.label.length > other.label.length) result += 1048583;
    if ((shape.flags | other.flags) & 0x40000000) result = -result;
    return result;
}

const shapes: Shape[] = [];
let parent: Shape | undefined = undefined;
for (let i = 0; i < 64; i++) {
    parent = { kind: 5940 + (i & 15), flags: i * 0x10001, objectFlags: i * 0x01010101, width: i / 3, height: 64 - i, parent, label: "s" + i };
    shapes.push(parent);
}
let sum = 0;
for (let round = 0; round < 300000; round++) {
    for (let i = 0; i < 63; i++) sum += measure(shapes[i], shapes[i + 1], 7);
}
console.log(sum);
