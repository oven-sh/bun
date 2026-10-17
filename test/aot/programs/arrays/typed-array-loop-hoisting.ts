let log: string[] = [];

function show(bytes: Uint8Array): string {
    const shown: number[] = [];
    bytes.length && bytes.forEach(byte => shown.push(byte));
    return bytes.length + ":" + shown.join(",");
}

function attempt(run: () => unknown): string {
    try {
        return String(run());
    } catch (error) {
        return (error as Error).constructor.name + " after " + log.join("");
    }
}

function copyAscii(text: string, bytes: Uint8Array): number {
    let at = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 128)
            bytes[at++] = code;
        else
            log.push("w");
    }
    return at;
}

function sumEven(bytes: Uint8Array, count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++) {
        if ((i & 1) === 0)
            sum += bytes[i] ?? 1000;
    }
    return sum;
}

function detach(bytes: Uint8Array): void {
    (bytes.buffer as ArrayBuffer).transfer();
}

function storeAndDetachAt(bytes: Uint8Array, count: number, when: number): string {
    let seen = "";
    for (let i = 0; i < count; i++) {
        if (i === when)
            detach(bytes);
        bytes[i] = i + 1;
        seen += bytes[i] + " ";
    }
    return seen + bytes.length;
}

function resizeAt(bytes: Uint8Array, buffer: ArrayBuffer, count: number, when: number, to: number): string {
    let seen = "";
    for (let i = 0; i < count; i++) {
        if (i === when)
            buffer.resize(to);
        bytes[i] = i + 1;
        seen += bytes[i] + " ";
    }
    return seen + bytes.length;
}

function takeBufferAt(bytes: Uint8Array, count: number, when: number): string {
    let other: Uint8Array | undefined;
    for (let i = 0; i < count; i++) {
        if (i === when)
            other = new Uint8Array(bytes.buffer);
        bytes[i] = i + 1;
    }
    return show(bytes) + " " + (other ? show(other) : "none");
}

function detachAndThrow(bytes: Uint8Array): void {
    (bytes.buffer as ArrayBuffer).transfer();
    throw new RangeError("gone");
}

function caughtInLoop(bytes: Uint8Array, count: number, when: number): string {
    let seen = "";
    for (let i = 0; i < count; i++) {
        try {
            if (i === when)
                detachAndThrow(bytes);
        } catch {
            seen += "caught ";
        }
        bytes[i] = i + 1;
        seen += bytes[i] + " ";
    }
    return seen + bytes.length;
}

function rows(bytes: Uint8Array, height: number, width: number, when: number): string {
    let sum = 0;
    for (let y = 0; y < height; y++) {
        if (y === when)
            detach(bytes);
        for (let x = 0; x < width; x++) {
            if (x !== 1)
                bytes[y * width + x] = y + x + 1;
            sum += bytes[y * width + x] ?? 100;
        }
    }
    return sum + " " + show(bytes);
}

function swapped(first: Uint8Array, second: Uint8Array, count: number): string {
    let bytes = first;
    for (let i = 0; i < count; i++) {
        bytes[i] = i + 1;
        bytes = bytes === first ? second : first;
    }
    return show(first) + " " + show(second);
}

class Writer {
    bytes = new Uint8Array(4);
    length = 0;
    grow(): void {
        const larger = new Uint8Array(this.bytes.length * 2);
        larger.set(this.bytes);
        this.bytes = larger;
    }
    write(text: string): void {
        let bytes = this.bytes;
        let at = this.length;
        for (let i = 0; i < text.length; i++) {
            if (at === bytes.length) {
                this.grow();
                bytes = this.bytes;
            }
            bytes[at++] = text.charCodeAt(i);
        }
        this.length = at;
    }
}

const none = undefined as unknown as Uint8Array;
const byName: { [name: string]: (...rest: any[]) => unknown } = { copyAscii, sumEven, storeAndDetachAt, resizeAt, takeBufferAt, caughtInLoop, rows, swapped };

const target = new Uint8Array(6);
console.log(copyAscii("abécd", target), show(target), log.join(""));
console.log(byName.copyAscii("0123456789", target), show(target));
log = [];
console.log(attempt(() => copyAscii("", none)), attempt(() => copyAscii("éé", none)), attempt(() => copyAscii("éx", none)));
console.log(sumEven(new Uint8Array([1, 2, 3, 4, 5]), 5), byName.sumEven(new Uint8Array([1, 2, 3]), 7), sumEven(new Uint8Array(0), 3), attempt(() => sumEven(none, 0)), attempt(() => sumEven(none, 1).toString().length > 0));
console.log(storeAndDetachAt(new Uint8Array(4), 4, 2));
console.log(byName.storeAndDetachAt(new Uint8Array(4), 4, 0));
console.log(storeAndDetachAt(new Uint8Array(4), 6, 9));
for (const [when, to] of [[2, 2], [2, 8], [0, 0], [9, 0]]) {
    const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
    console.log(resizeAt(new Uint8Array(buffer), buffer, 6, when, to));
    const fixed = new ArrayBuffer(4, { maxByteLength: 8 });
    console.log(byName.resizeAt(new Uint8Array(fixed, 0, 3), fixed, 6, when, to));
}
console.log(takeBufferAt(new Uint8Array(4), 4, 2), "|", byName.takeBufferAt(new Uint8Array(4), 4, 9), "|", takeBufferAt(new Uint8Array(300), 2, 1).length);
console.log(caughtInLoop(new Uint8Array(4), 4, 1), "|", byName.caughtInLoop(new Uint8Array(4), 4, 7));
console.log(rows(new Uint8Array(6), 2, 3, 5), "|", byName.rows(new Uint8Array(6), 2, 3, 1), "|", rows(new Uint8Array(4), 2, 3, 9));
console.log(swapped(new Uint8Array(3), new Uint8Array(3), 5));
const writer = new Writer();
writer.write("hello, ");
writer.write("typed arrays");
console.log(writer.length, writer.bytes.length, String.fromCharCode(...writer.bytes.subarray(0, writer.length)));
