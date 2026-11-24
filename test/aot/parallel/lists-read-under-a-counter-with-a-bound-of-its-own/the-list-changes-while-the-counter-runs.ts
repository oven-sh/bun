// The list is handed in, and its length changes in the middle of the loop that reads it under a counter with a bound of its own: by `length =`, pop and push, under its own name, under another name for the same list,
// through a field of an object, by a function that nobody sees into; and the variable comes to hold another list.
function make(size: number) {
    const list: number[] = [];
    for (let i = 0; i < size; i++)
        list.push(i + 0.5);
    return list;
}
function cutAt(list: number[], n: number, at: number, to: number) {
    n |= 0; at |= 0; to |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        if (i === at)
            list.length = to;
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing} ${list.length}`;
}
function poppedBehindTheRead(list: number[], n: number) {
    n |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
        if ((i & 1) === 1)
            list.pop();
    }
    return `${seen} ${missing} ${list.length}`;
}
function grown(list: number[], n: number) {
    n |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
        if (i < 3)
            list.push(100.5);
    }
    return `${seen} ${missing} ${list.length}`;
}
function cutUnderAnotherName(list: number[], other: number[], n: number, at: number) {
    n |= 0; at |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        if (i === at)
            other.length = 1;
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing} ${list.length}`;
}
function poppedUnderAnotherName(list: number[], other: number[], n: number) {
    n |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
        other.pop();
    }
    return `${seen} ${missing} ${list.length}`;
}
function cutThroughField(list: number[], holder: { held: number[] }, n: number, at: number) {
    n |= 0; at |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        if (i === at)
            holder.held.length = 0;
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing} ${list.length}`;
}
function cutInOuterTurn(list: number[], other: number[], n: number, rounds: number) {
    n |= 0; rounds |= 0;
    let seen = 0, missing = 0;
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < n; i++) {
            const found = list[i];
            if (found === undefined)
                missing++;
            else
                seen += found;
        }
        other.pop();
    }
    return `${seen} ${missing} ${list.length}`;
}
const deeds: Record<string, (list: number[], i: number) => void> = {
    nothing: () => { },
    cut: (list, i) => { if (i === 2) list.length = 3; },
    refill: (list, i) => { if (i === 4) { list.length = 0; for (let k = 0; k < 8; k++) list.push(k + 0.5); } },
};
function whileSomebodyActs(list: number[], n: number, deed: string) {
    n |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        deeds[deed](list, i);
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing} ${list.length}`;
}
function anotherList(list: number[], short: number[], n: number, at: number) {
    n |= 0; at |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        if (i === at)
            list = short;
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing}`;
}
const ways: Record<string, (n: number) => unknown> = {
    cutToTwo: n => cutAt(make(8), n, 3, 2),
    cutToNone: n => cutAt(make(700), n, 5, 0),
    neverCut: n => cutAt(make(8), n, -1, 0),
    poppedBehindTheRead: n => poppedBehindTheRead(make(8), n),
    grown: n => grown(make(4), n),
    sameListCut: n => { const list = make(700); return cutUnderAnotherName(list, list, n, 2); },
    otherListCut: n => cutUnderAnotherName(make(700), make(3), n, 2),
    sameListPopped: n => { const list = make(700); return poppedUnderAnotherName(list, list, n); },
    otherListPopped: n => poppedUnderAnotherName(make(700), make(3), n),
    sameListInField: n => { const list = make(700); return cutThroughField(list, { held: list }, n, 3); },
    otherListInField: n => cutThroughField(make(700), { held: make(2) }, n, 3),
    sameListCutOutside: n => { const list = make(12); return cutInOuterTurn(list, list, n, 6); },
    otherListCutOutside: n => cutInOuterTurn(make(12), make(2), n, 6),
    nothing: n => whileSomebodyActs(make(8), n, "nothing"),
    cut: n => whileSomebodyActs(make(8), n, "cut"),
    refill: n => whileSomebodyActs(make(8), n, "refill"),
    anotherList: n => anotherList(make(8), make(2), n, 1),
};
for (const name of Object.keys(ways)) {
    for (const n of [0, 1, 4, 8, 12, 650])
        console.log(name, n, String(ways[name](n)));
}
