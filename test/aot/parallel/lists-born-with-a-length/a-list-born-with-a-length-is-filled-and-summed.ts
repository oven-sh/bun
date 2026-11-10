// `new Array(n | 0)` is filled with whole numbers and summed in a loop: the list is born to hold doubles, so the loop asks for doubles alone.
// STATISTIC: ArrayGuardsNarrowedToDouble >= 1
function sumOfFilled(n: number, rounds: number) {
    const list: number[] = new Array(n | 0);
    for (let i = 0; i < n; i++)
        list[i] = i;
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < list.length; i++)
            sum += list[i];
    }
    return sum;
}
const ways = { sumOfFilled };
for (const name of Object.keys(ways) as (keyof typeof ways)[]) {
    for (const n of [0, 1, 2, 7, 100, 1000])
        console.log(name, n, ways[name](n, 3));
}
