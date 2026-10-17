// Loops over typed arrays that step by one or by two, or leave in the middle: what is tested once ahead of the loop is tested again where the array changes under it.
declare const console: any;

function lengthOfQuoted(bytes: Uint8Array): number {
    let i = 0;
    while (i < bytes.length) {
        const c = bytes[i];
        if (c === 34) break;
        if (c === 92) { i += 2; continue; }
        if (c < 32) return -2;
        i++;
    }
    return i;
}

function filled(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}

function sumWhileItShrinks(bytes: Uint8Array, buffer: ArrayBuffer, shrinkAt: number, to: number): number {
    let sum = 0;
    let i = 0;
    while (i < bytes.length) {
        const c = bytes[i];
        if (i === shrinkAt) buffer.resize(to);
        if (c === 92) { i += 2; continue; }
        sum += c;
        i++;
    }
    return sum * 1000 + i;
}

function sumWhileItGrows(bytes: Uint8Array, buffer: ArrayBuffer, growAt: number, to: number): number {
    let sum = 0;
    let i = 0;
    while (i < bytes.length) {
        if (i === growAt) buffer.resize(to);
        const c = bytes[i];
        if (c === 1) { i += 2; continue; }
        sum += c + 1;
        i++;
    }
    return sum * 1000 + i;
}

function sumUntilItIsDetached(bytes: Uint8Array, detachAt: number): number {
    let sum = 0;
    let i = 0;
    while (i < bytes.length) {
        if (i === detachAt) (bytes.buffer as ArrayBuffer).transfer();
        const c = bytes[i];
        if (c === undefined) { sum += 1000000; break; }
        if (c === 92) { i += 2; continue; }
        sum += c;
        i++;
    }
    return sum * 1000 + i;
}

function writesWithTwoSteps(bytes: Uint8Array): number {
    let i = 0;
    let written = 0;
    while (i < bytes.length) {
        if (bytes[i] === 92) { bytes[i] = 47; i += 2; continue; }
        bytes[i] = bytes[i] ^ 32;
        written++;
        i++;
    }
    return written;
}

function readsPastTheEnd(bytes: Uint8Array): string {
    let seen = "";
    let i = 0;
    while (i < bytes.length + 3) {
        const c = bytes[i];
        if (c === 92) { i += 2; continue; }
        seen += c === undefined ? "u" : String(c % 10);
        i++;
    }
    return seen;
}

function overOtherKinds(values: Int16Array | Float64Array | Uint8ClampedArray): number {
    let sum = 0;
    let i = 0;
    while (i < values.length) {
        const value = values[i];
        if (value < 0) { i += 2; continue; }
        sum += value;
        i++;
    }
    return sum;
}

console.log(lengthOfQuoted(filled('plain"')), lengthOfQuoted(filled('a\\"b"c')), lengthOfQuoted(filled("no quote")), lengthOfQuoted(filled("tab\there")), lengthOfQuoted(filled("")), lengthOfQuoted(filled("ends in \\")), lengthOfQuoted(filled("\\\\\\\\")));
for (const [at, to] of [[0, 0], [1, 1], [3, 2], [3, 4], [5, 6], [7, 8], [9, 3]]) {
    const buffer = new ArrayBuffer(10, { maxByteLength: 32 });
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < 10; i++) bytes[i] = i === 4 ? 92 : i + 1;
    console.log("shrinks", at, to, sumWhileItShrinks(bytes, buffer, at, to), bytes.length);
}
for (const [at, to] of [[0, 12], [3, 32], [9, 11]]) {
    const buffer = new ArrayBuffer(10, { maxByteLength: 32 });
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < 10; i++) bytes[i] = i % 3;
    console.log("grows", at, to, sumWhileItGrows(bytes, buffer, at, to), bytes.length);
}
{
    const buffer = new ArrayBuffer(16, { maxByteLength: 32 });
    const part = new Uint8Array(buffer, 4, 8);
    for (let i = 0; i < 8; i++) part[i] = i + 1;
    console.log("a part with a length of its own", sumWhileItShrinks(part, buffer, 2, 8), part.length, sumWhileItShrinks(part, buffer, 0, 16), part.length);
}
for (const at of [0, 1, 5, 9, 20]) console.log("detached", at, sumUntilItIsDetached(filled("ab\\cdefghi"), at));
{
    const bytes = filled("ab\\cd\\\\e");
    console.log(writesWithTwoSteps(bytes), Array.from(bytes).join(","));
}
console.log(readsPastTheEnd(filled("ab\\cd")), readsPastTheEnd(filled("")), readsPastTheEnd(filled("abc\\")));
console.log(overOtherKinds(new Int16Array([1, -1, 100, 2, -5])), overOtherKinds(new Float64Array([0.5, -0.5, NaN, 1.25])), overOtherKinds(new Uint8ClampedArray([300, 2, 3])));
export {};
