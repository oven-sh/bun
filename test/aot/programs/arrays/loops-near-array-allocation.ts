function sumOfDoublesMadeHere(n: number): number {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(i * 0.5);
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t;
}

function sumOfIntegersMadeHere(n: number): number {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(i);
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t;
}

function sumOfLiteral(): number {
    const a = [1.5, 2.5, 3.5, 4.5];
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t;
}

function sumOfNothing(): number {
    const a: number[] = [];
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t;
}

function lengthsOfStringsMadeHere(n: number): number {
    const a: string[] = [];
    for (let i = 0; i < n; i++) a.push("x".repeat(i % 5));
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i].length;
    return t;
}

function sumWhereTheKindChangesInTheLoop(n: number): string {
    const a: (number | string)[] = [];
    for (let i = 0; i < n; i++) a.push(i * 0.5);
    let t = 0, s = "";
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        if (typeof x === "number") t += x; else s += x;
        if (i === 10) a[20] = "twenty";
    }
    return t + s;
}

function sumWhereAnElementChangesTheArray(n: number): string {
    const a: (number | { valueOf(): number })[] = [];
    for (let i = 0; i < n; i++) a.push(i * 0.5);
    let calls = 0;
    a[7] = {
        valueOf() {
            calls++;
            a[9] = { valueOf() { calls++; return 900; } };
            a.length = 12;
            return 1000;
        },
    };
    let t = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        t += typeof x === "number" ? x : x.valueOf();
    }
    return t + " " + calls + " " + a.length;
}

function sumWhereTheArrayGrowsInTheLoop(n: number): number {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(i + 0.25);
    let t = 0;
    for (let i = 0; i < a.length; i++) {
        t += a[i];
        if (a.length < 2 * n) a.push(1);
    }
    return t;
}

function sumWhereTheArrayShrinksInTheLoop(n: number): number {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(i + 0.25);
    let t = 0;
    for (let i = 0; i < a.length; i++) {
        t += a[i];
        if (i % 3 === 0) a.pop();
    }
    return t;
}

function sumPastTheEnd(n: number): string {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(i + 0.5);
    let t = 0, missing = 0;
    for (let i = 0; i < n + 3; i++) {
        const x = a[i];
        if (x === undefined) missing++; else t += x;
    }
    return t + " " + missing;
}

function bytesWrittenHere(n: number): number {
    const bytes = new Uint8Array(n);
    let t = 0;
    for (let i = 0; i < bytes.length; i++) { bytes[i] = i & 255; t += 1; }
    for (let i = 0; i < bytes.length; i++) t += bytes[i];
    return t;
}

function bytesWrittenPastTheEnd(n: number): string {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n + 4; i++) bytes[i] = i + 1;
    let t = 0, missing = 0;
    for (let i = 0; i < n + 4; i++) {
        const x = bytes[i];
        if (x === undefined) missing++; else t += x;
    }
    return t + " " + missing + " " + bytes.length;
}

function bytesOfABufferThatIsTransferredInTheLoop(n: number): string {
    const bytes = new Uint8Array(n);
    const values: unknown[] = [];
    for (let i = 0; i < n; i++) values.push(i);
    values[5] = { valueOf() { bytes.buffer.transfer(); return 77; } };
    let turns = 0;
    for (let i = 0; i < bytes.length; i++) { bytes[i] = values[i] as any; turns++; }
    return turns + " " + bytes.length + " " + bytes[0];
}

function bytesOfABufferThatIsResizedInTheLoop(n: number): string {
    const buffer = new ArrayBuffer(n, { maxByteLength: 4 * n });
    const bytes = new Uint8Array(buffer);
    const values: unknown[] = [];
    for (let i = 0; i < 4 * n; i++) values.push(i);
    values[3] = { valueOf() { buffer.resize(2 * n); return 33; } };
    values[n + 2] = { valueOf() { buffer.resize(n + 4); return 44; } };
    let turns = 0, t = 0;
    for (let i = 0; i < bytes.length; i++) { bytes[i] = values[i] as any; turns++; }
    for (let i = 0; i < bytes.length; i++) t += bytes[i];
    return turns + " " + bytes.length + " " + t;
}

function doublesWrittenHere(n: number): number {
    const doubles = new Float64Array(n);
    for (let i = 0; i < doubles.length; i++) doubles[i] = i * 0.25;
    let t = 0;
    for (let i = 0; i < doubles.length; i++) t += doubles[i];
    return t;
}

function viewOfPartOfABuffer(n: number): number {
    const buffer = new ArrayBuffer(4 * n);
    const words = new Uint16Array(buffer, 2 * n, n);
    for (let i = 0; i < words.length; i++) words[i] = i * 3;
    const all = new Uint8Array(buffer);
    let t = 0;
    for (let i = 0; i < all.length; i++) t += all[i];
    return t;
}

function sum(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function fill(bytes: Uint8Array): number { let t = 0; for (let i = 0; i < bytes.length; i++) { bytes[i] = i & 255; t += 1; } return t; }
function total(bytes: Uint8Array): number { let t = 0; for (let i = 0; i < bytes.length; i++) t += bytes[i]; return t; }

function kernelsCopiedBesideTheBirth(rounds: number): number {
    const a: number[] = [];
    for (let i = 0; i < 100; i++) a.push(i * 0.5);
    const bytes = new Uint8Array(100);
    let t = 0;
    for (let r = 0; r < rounds; r++) t += sum(a) + fill(bytes) + total(bytes);
    return t;
}

for (const n of [0, 1, 2, 30, 1000]) {
    console.log(n, sumOfDoublesMadeHere(n), sumOfIntegersMadeHere(n), lengthsOfStringsMadeHere(n), sumWhereTheArrayGrowsInTheLoop(n), sumWhereTheArrayShrinksInTheLoop(n), sumPastTheEnd(n));
    console.log(n, bytesWrittenHere(n), bytesWrittenPastTheEnd(n), doublesWrittenHere(n), viewOfPartOfABuffer(n));
}
console.log(sumOfLiteral(), sumOfNothing(), sumWhereTheKindChangesInTheLoop(30), sumWhereAnElementChangesTheArray(30));
console.log(bytesOfABufferThatIsTransferredInTheLoop(20), bytesOfABufferThatIsResizedInTheLoop(10));
console.log(kernelsCopiedBesideTheBirth(3));
