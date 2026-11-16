// `wanted` is written as an object, null or undefined, and nothing holds a caller out of sight to that. In a loop the comparison asks the kind of that one operand and then compares bits.
// Text that the build has not seen hands over every pair out of 35 values of every kind, on both sides: what is written arrives, and so do numbers in both forms, NaN, texts that are flat,
// joined and equal in content, big integers equal in content, symbols, functions, a Proxy. Each answer is held against the same question asked in the unseen text.
function countOnLeft(wanted: object | null | undefined, next: () => unknown, times: number): number {
    let found = 0;
    for (let i = 0; i < times; i++)
        if (wanted === next())
            found++;
    return found;
}
function countOnRight(next: () => unknown, wanted: object | null | undefined, times: number): number {
    let found = 0;
    for (let i = 0; i < times; i++)
        if (next() !== wanted)
            found--;
        else
            found++;
    return found;
}
function lastAnswer(wanted: object | null | undefined, next: () => unknown, times: number): boolean {
    let answer = false;
    for (let i = 0; i < times; i++)
        answer = wanted === next();
    return answer;
}
function indexOf(list: unknown[], wanted: object): number {
    for (let i = 0; i < list.length; i++)
        if (list[i] === wanted)
            return i;
    return -1;
}
console.log(new Function("countOnLeft", "countOnRight", "lastAnswer", "indexOf", `
    const joined = (a, b) => a + b;
    const half = Number("0.5");
    const shared = { };
    const values = [
        undefined, null, true, false, 0, -0, 1, half + half, 2147483647, 2147483646 + half + half, -1, NaN, Number("x"), Infinity, -Infinity, 1.5,
        "", "a", joined("long enough to stay ", "a text of two parts"), joined("long enough to stay ", "a text of two parts"), "long enough to stay a text of two parts", String(1), "1",
        1n, BigInt("1"), 2n ** 70n, BigInt("1180591620717411303424"), Symbol.iterator, Symbol("a"), shared, { }, [], () => { }, new Proxy(shared, { }), Object.create(null),
    ];
    const lines = [];
    for (const a of values) {
        let line = "";
        for (const b of values) {
            const same = a === b;
            const right = countOnLeft(a, () => b, 2) === (same ? 2 : 0) && countOnRight(() => a, b, 2) === (same ? 2 : -2) && lastAnswer(a, () => b, 2) === same;
            line += right ? (same ? "=" : ".") : "!";
        }
        lines.push(line + " " + indexOf(values, a));
    }
    return lines.join("\\n");
`)(countOnLeft, countOnRight, lastAnswer, indexOf));
