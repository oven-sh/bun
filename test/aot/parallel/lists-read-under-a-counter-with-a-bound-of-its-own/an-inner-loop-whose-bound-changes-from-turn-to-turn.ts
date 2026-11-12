// The list is read in an inner loop whose bound the outer loop takes from another list: below, at and beyond the length in turn.
function sums(list: number[], bounds: number[]) {
    let seen = 0, missing = 0;
    for (let k = 0; k < bounds.length; k++) {
        const n = bounds[k] | 0;
        for (let i = 0; i < n; i++) {
            const found = list[i];
            if (found === undefined)
                missing++;
            else
                seen += found;
        }
    }
    return `${seen} ${missing}`;
}
function texts(list: string[], bounds: number[]) {
    let joined = "";
    for (let k = 0; k < bounds.length; k++) {
        const n = bounds[k] | 0;
        for (let i = 0; i < n; i++)
            joined += list[i];
    }
    return joined;
}
function withHoles(n: number, rounds: number) {
    n |= 0; rounds |= 0;
    const list: number[] = new Array(8);
    for (let i = 0; i < 8; i += 2)
        list[i] = i + 0.5;
    let seen = 0, missing = 0;
    for (let k = 0; k < rounds; k++) {
        for (let i = 0; i < n; i++) {
            const found = list[i];
            if (found === undefined)
                missing++;
            else
                seen += found;
        }
    }
    return `${seen} ${missing}`;
}
const ways: Record<string, () => unknown> = {
    sums: () => sums([0.5, 1.5, 2.5, 3.5], [0, 2, 4, 5, 900, 1]),
    wholes: () => sums([1, 2, 3, 4], [4, 6, 0, 3]),
    texts: () => texts(["a", "b", "c"], [1, 3, 4, 0, 2]),
    holes4: () => withHoles(4, 3),
    holes8: () => withHoles(8, 3),
    holes12: () => withHoles(12, 3),
};
for (const name of Object.keys(ways))
    console.log(name, String(ways[name]()));
