// `for (i < n) sum += list[i]` where n is less than, equal to and greater than the length of the list.
// STATISTIC: LoopBoundsClampedToArrays >= 1
function sumTo(list: number[], n: number) {
    n |= 0;
    let sum = 0;
    for (let i = 0; i < n; i++)
        sum += list[i];
    return sum;
}
function countDefinedTo(list: number[], n: number) {
    n |= 0;
    let defined = 0, missing = 0;
    for (let i = 0; i < n; i++) {
        if (list[i] === undefined)
            missing++;
        else
            defined++;
    }
    return `${defined} ${missing}`;
}
function upToAndWith(list: number[], n: number) {
    n |= 0;
    let sum = 0;
    for (let i = 0; i <= n; i++)
        sum += list[i];
    return sum;
}
const doubles = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
const wholes = [1, 2, 3, 4, 5, 6, 7, 8];
const ways: Record<string, (list: number[], n: number) => unknown> = { sumTo, countDefinedTo, upToAndWith };
for (const name of Object.keys(ways)) {
    for (const list of [doubles, wholes, []]) {
        for (const n of [0, 1, 7, 8, 9, 40, 4000])
            console.log(name, list.length, n, String(ways[name](list, n | 0)));
    }
}
