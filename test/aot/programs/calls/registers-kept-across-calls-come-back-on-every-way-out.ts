type Item = { id: number; name: string; next: Item | null };

function make(id: number, next: Item | null): Item {
    return { id, name: "item" + id, next };
}

function weigh(item: Item): number {
    return item.id * 3 + item.name.length;
}

function describe(item: Item, prefix: string): string {
    return prefix + item.name + ":" + item.id;
}

function fail(item: Item): never {
    throw new Error("refused " + item.name);
}

function manyWaysOut(a: Item, b: Item, c: Item, mode: number): string {
    const first = weigh(a);
    const second = weigh(b);
    if (mode === 0)
        return describe(a, "zero ") + first;
    const third = weigh(c);
    if (mode === 1)
        return describe(b, "one ") + (first + second);
    if (mode === 2)
        return describe(c, "two ") + (first + second + third);
    if (mode === 3)
        fail(b);
    let text = "";
    for (let i = 0; i < mode; i++)
        text += describe(i % 2 ? a : c, String(i)) + (first - second + third) + ";";
    return text;
}

function caller(a: Item, b: Item, c: Item): string {
    const kept = weigh(a) + weigh(b);
    const label = describe(c, "kept ");
    let out = "";
    for (let mode = 0; mode < 7; mode++) {
        try {
            out += manyWaysOut(a, b, c, mode) + "|";
        } catch (error) {
            out += "caught " + (error as Error).message + "|";
        }
        out += kept + label + "|";
    }
    return out;
}

function oneKept(item: Item, times: number): number {
    let sum = 0;
    for (let i = 0; i < times; i++)
        sum += weigh(item);
    return sum;
}

function onlyKept(a: Item, b: Item): number {
    weigh(a);
    weigh(b);
    weigh(a);
    return weigh(b) + weigh(a);
}

function throughTailCall(a: Item, b: Item, depth: number): number {
    const here = weigh(a) + weigh(b);
    if (!depth)
        return here;
    return throughTailCall(b, a, depth - 1) + here;
}

function deep(item: Item, other: Item, depth: number): number {
    const before = weigh(item);
    const below = deep(other, item, depth + 1);
    return before + below + weigh(other);
}

function overflow(a: Item, b: Item): string {
    const kept = describe(a, "before ");
    const weight = weigh(b);
    try {
        deep(a, b, 0);
        return "no overflow";
    } catch (error) {
        return kept + " " + weight + " " + (error instanceof RangeError);
    }
}

function throwsThroughThreeFrames(a: Item, b: Item, c: Item): string {
    const x = weigh(a);
    const y = describe(b, "y ");
    function inner(level: number, p: Item, q: Item): number {
        const w = weigh(p);
        const v = weigh(q);
        if (!level)
            fail(q);
        return inner(level - 1, q, p) + w + v;
    }
    try {
        return String(inner(3, b, c));
    } catch (error) {
        return x + y + (error as Error).message;
    }
}

const a = make(1, null);
const b = make(22, a);
const c = make(333, b);
console.log(caller(a, b, c));
console.log(oneKept(c, 5), onlyKept(a, c), throughTailCall(a, b, 6));
console.log(overflow(a, c));
console.log(overflow(b, a));
console.log(throwsThroughThreeFrames(a, b, c));
