// IRM= 4 CallDirect \(v[0-9]+, v[0-9]+, v[0-9]+\) function=f[0-9]+
interface Item { kind: number; flags: number; next: Item | undefined; name: string; weight: number }

const seen: string[] = [];
function describe(item: Item, depth: number): string {
    let text = item.name + ":" + item.kind;
    if (depth > 0 && item.next) text += "," + describe(item.next, depth - 1);
    return text;
}
function note(text: string): number {
    seen.push(text);
    return seen.length;
}
function classify(item: Item, mask: number, scale: number): number {
    if (item.flags & mask) return item.kind;
    if (item.weight > scale) return item.weight * 0.5 + 1048577.25;
    let total = 0;
    for (let other: Item | undefined = item; other; other = other.next) {
        const text = describe(other, 2);
        total += note(text) + text.length * 3 + other.kind * 65537;
        if (other.flags === 0x12345678) total += note(other.name + "!") * 1000003;
        if (other.weight !== other.weight) total -= note("NaN") * 7;
        if (other.kind > 60 && other.name.length > 5) total += note(describe(other, 1)) * 31 + other.name.length;
        if (other.kind % 7 === 3 || other.flags % 5 === 2) total += note(other.name + "?" + other.flags) * 131071;
        if (other.next && other.next.kind + 1 !== other.kind) total -= note("out of order: " + other.next.name) * 8191;
        if (total > 1e15) total = total % 1000000007 + note("wrapped");
    }
    return total + mask * 16777259;
}

const items: Item[] = [];
let previous: Item | undefined = undefined;
for (let i = 0; i < 64; i++) {
    previous = { kind: i, flags: i === 63 ? 0 : (i & 7) + 1 | 8, next: previous, name: "item" + i, weight: i === 62 ? 1e9 : i / 4 };
    items.push(previous);
}
let sum = 0;
for (let round = 0; round < 400000; round++) {
    for (let i = 0; i < 62; i++) sum += classify(items[i], 8, 100);
}
sum += classify(items[62], 16, 100) + classify(items[63], 8, 100) + classify(items[61], 16, 1e12);
console.log(sum, seen.length, seen[seen.length - 1]);
