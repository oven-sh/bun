const memory = new WebAssembly.Memory({ initial: 1 });
const size: number = memory.buffer.byteLength;
const pair = new Uint8Array(memory.buffer, size - 2, 2);
pair[0] = 1;
pair[1] = 4;

function turnsOfPair(view: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((view[0] & 3) !== 1 || (view[1] & 5) !== 4)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsWhilePairIsWritten(view: Uint8Array, turns: number): number {
    let passed = 0;
    while (passed < turns) {
        if ((view[0] & 3) !== 1 || (view[1] & 5) !== 4)
            throw new RangeError("not marked within " + turns + " turns");
        passed++;
        view[0] = 1;
    }
    return passed;
}

console.log(turnsOfPair(pair, new Int32Array(2), Number("9")), turnsWhilePairIsWritten(pair, Number("9")));

function turnsOfTwo(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[0] & 3) !== 1 || (marks[1] & 5) !== 4)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfThree(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[0] & 3) !== 1 || (marks[1] & 5) !== 4 || (marks[2] & 0x70) !== 0x30)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfFour(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[0] & 3) !== 1 || (marks[1] & 5) !== 4 || (marks[2] & 0x70) !== 0x30 || (marks[3] & 0x83) !== 0x81)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfEverySecond(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[0] & 3) !== 1 || (marks[2] & 0x70) !== 0x30)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfTwoInside(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[1] & 5) !== 4 || (marks[2] & 0x70) !== 0x30)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfTwoBackward(marks: Uint8Array, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((marks[1] & 5) !== 4 || (marks[0] & 3) !== 1)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

const right = [0xa9, 0xfe, 0xb7, 0xfd];

function row(name: string, length: number, turnsOf: (marks: Uint8Array, seen: Int32Array, turns: number) => number): void {
    const marks = new Uint8Array(memory.buffer, size - length, length);
    const told: string[] = [];
    const ask = () => {
        try {
            told.push(String(turnsOf(marks, new Int32Array(1), Number("9"))));
        } catch (error) {
            told.push((error as Error).message.slice(0, 10));
        }
    };
    for (let at = 0; at < length; at++)
        marks[at] = right[at];
    ask();
    for (let at = 0; at < length; at++) {
        for (let bit = 1; bit < 256; bit <<= 1) {
            marks[at] = right[at] ^ bit;
            ask();
            marks[at] = right[at];
        }
    }
    console.log(name, told.join(" "));
}

row("two", 2, turnsOfTwo);
row("three", 3, turnsOfThree);
row("four", 4, turnsOfFour);
row("every second", 3, turnsOfEverySecond);
row("two inside", 3, turnsOfTwoInside);
row("two backward", 2, turnsOfTwoBackward);

const flags = new Uint8Array(memory.buffer, size - 2, 2);
flags[0] = right[0];
flags[1] = right[1];
console.log(turnsOfTwo(flags, new Int32Array(2), Number("9")));
