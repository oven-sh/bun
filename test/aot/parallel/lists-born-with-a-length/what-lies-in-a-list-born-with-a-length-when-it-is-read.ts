// Between the birth of `new Array(n)` and the loop that reads it: nothing is stored, half is stored, fractions, NaN and -0, a text, a longer and a shorter length.
function sum(list: any[], rounds: number) {
    let sum: any = 0;
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < list.length; i++)
            sum += list[i];
    }
    return sum;
}
function holesAlone(n: number) {
    const list: number[] = new Array(n | 0);
    let total = 0, holes = 0;
    for (let i = 0; i < list.length; i++) {
        total += list[i];
        if (!(i in list))
            holes++;
    }
    return `${total} ${holes}`;
}
function halfFilled(n: number) {
    const list: number[] = new Array(n | 0);
    for (let i = 0; i < n; i += 2)
        list[i] = i;
    let total = 0, seen = 0;
    for (let i = 0; i < list.length; i++) {
        const found = list[i];
        if (found !== undefined) {
            total += found;
            seen++;
        }
    }
    return `${total} ${seen}`;
}
function fractions(n: number) {
    const list: number[] = new Array(n | 0);
    for (let i = 0; i < n; i++)
        list[i] = i % 3 === 0 ? NaN : i % 3 === 1 ? -0 : i + 0.5;
    let total = 0, zeros = 0, nans = 0;
    for (let i = 0; i < list.length; i++) {
        const found = list[i];
        if (found !== found)
            nans++;
        else if (Object.is(found, -0))
            zeros++;
        else
            total += found;
    }
    return `${total} ${zeros} ${nans}`;
}
function aTextAmongNumbers(n: number, at: number) {
    const list: any[] = new Array(n | 0);
    for (let i = 0; i < n; i++)
        list[i] = i;
    if (at < n)
        list[at] = "x";
    let joined: any = 0;
    for (let i = 0; i < list.length; i++)
        joined += list[i];
    return joined;
}
function lengthChanged(n: number, to: number) {
    const list: number[] = new Array(n | 0);
    for (let i = 0; i < n; i++)
        list[i] = i + 1;
    list.length = to;
    let total = 0;
    for (let i = 0; i < list.length; i++)
        total += list[i] === undefined ? 1000 : list[i];
    return `${total} ${list.length}`;
}
function growsWhileItIsRead(n: number) {
    const list: number[] = new Array(n | 0);
    for (let i = 0; i < n; i++)
        list[i] = 1;
    let total = 0;
    for (let i = 0; i < list.length; i++) {
        total += list[i];
        if (list.length < n + 3)
            list.push(10);
    }
    return `${total} ${list.length}`;
}
const ways: Record<string, (n: number) => unknown> = {
    holesAlone, halfFilled, fractions, growsWhileItIsRead,
    textAtThree: n => aTextAmongNumbers(n, 3),
    textNowhere: n => aTextAmongNumbers(n, n),
    longer: n => lengthChanged(n, n + 2),
    shorter: n => lengthChanged(n, n >> 1),
    handedOn: n => { const list = new Array(n | 0); for (let i = 0; i < n; i++) list[i] = i * 0.5; return sum(list, 2); },
};
for (const name of Object.keys(ways)) {
    for (const n of [0, 1, 4, 9, 64])
        console.log(name, n, String(ways[name](n)));
}
