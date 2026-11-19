// The key is the counter and something beside it: `list[i + 1]`, `list[i + far]`, a counter that starts above zero, below zero, and steps by two.
function next(list: number[], n: number) {
    n |= 0;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += list[i + 1] === undefined ? 1000 : list[i + 1];
    return sum;
}
function farther(list: number[], n: number, far: number) {
    n |= 0; far |= 0;
    let seen = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        const found = list[i + far];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing}`;
}
function from(list: number[], start: number, n: number) {
    start |= 0; n |= 0;
    let seen = 0, missing = 0;
    for (let i = start; i < n; i++) {
        const found = list[i];
        if (found === undefined)
            missing++;
        else
            seen += found;
    }
    return `${seen} ${missing}`;
}
function byTwo(list: number[], n: number) {
    n |= 0;
    let sum = 0;
    for (let i = 0; i < n; i += 2)
        sum += list[i] === undefined ? 1000 : list[i];
    return sum;
}
const list = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const ways: Record<string, (n: number) => unknown> = {
    next: n => next(list, n),
    far2: n => farther(list, n, 2),
    far600: n => farther(list, n, 600),
    from3: n => from(list, 3, n),
    fromBelow: n => from(list, -2, n),
    byTwo: n => byTwo(list, n),
};
for (const name of Object.keys(ways)) {
    for (const n of [0, 1, 6, 7, 8, 9, 30])
        console.log(name, n, String(ways[name](n | 0)));
}
