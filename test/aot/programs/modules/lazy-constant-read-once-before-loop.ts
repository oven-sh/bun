const classes = new Uint8Array(256);
const names = new Map<number, string>();
const weights = [1, 2, 3, 4];
const limits = { low: 2, high: 5 };

function prepare(): void {
    for (let i = 97; i < 123; i++)
        classes[i] = 1;
    for (let i = 48; i < 58; i++)
        classes[i] = 2;
    names.set(1, "letter");
    names.set(2, "digit");
}

function classify(text: string, from: number): number {
    let sum = from;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 256)
            sum += classes[code];
    }
    return sum;
}

function pick(text: string, from: number): number {
    let sum = from;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 128)
            sum += classes[code];
        else
            sum -= classes[code & 255];
    }
    return sum;
}

function nested(rows: string[], from: number): number {
    let sum = from;
    for (const row of rows) {
        for (let i = 0; i < row.length; i++)
            sum += classes[row.charCodeAt(i) & 255] * 10;
        sum += classes[row.length & 255];
    }
    return sum;
}

function lookUp(kinds: number[], separator: string): string {
    let found = "";
    for (const kind of kinds)
        found += (names.get(kind) ?? "other") + separator;
    return found;
}

function weigh(count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++) {
        try {
            if (i > limits.high)
                throw new RangeError("high");
            sum += weights[i & 3] * (i < limits.low ? 1 : 2);
        } catch {
            sum -= weights.length;
        }
    }
    return sum;
}

function later(count: number): () => number {
    const readers: (() => number)[] = [];
    for (let i = 0; i < count; i++)
        readers.push(() => classes[97 + i] + weights[i & 3]);
    return () => readers.reduce((sum, read) => sum + read(), 0);
}

function never(count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++)
        sum += classes[i];
    return sum;
}

const byName: { [name: string]: (...rest: any[]) => unknown } = { classify, pick, nested, lookUp, weigh, later, never };
console.log(never(0), classify("", 0), classify("ab1", 0));
prepare();
console.log(classify("ab1 éЖz", 0), byName.classify("0123", 5), nested(["a1", "", "zz9"], 0), byName.nested([], 7));
console.log(lookUp([1, 2, 3], ","), byName.lookUp([], "-"), weigh(9), byName.weigh(0), later(3)(), (byName.later(0) as () => number)());
classes[97] = 7;
weights[0] = 100;
console.log(classify("aa", 0), nested(["a"], 0), weigh(5), later(2)(), never(98));
console.log(pick("a1\u00e1\u0161", 0), byName.pick("", 3), pick("zz", -1));
