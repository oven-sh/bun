function f(i: number): number { return i + 0.5; }
function one(i: number): number[] { return [f(i)]; }
function two(i: number): number[] { return [f(i), i]; }
function four(i: number): number[] { return [f(i), i, i * 2, f(i) * f(i)]; }
function seven(i: number): number[] { return [f(i), i, i + 1, i + 2, f(i + 3), i + 4, f(i + 5)]; }
function nine(i: number): number[] { return [f(i), 1, 2, 3, 4, 5, 6, 7, f(8)]; }
function seventeen(i: number): number[] { return [f(i), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, f(16)]; }
function forty(i: number): number[] { return [f(i), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, f(39)]; }
function wholes(i: number): number[] { return [i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15, i + 16, i + 17]; }
for (const born of [one, two, four, seven, nine, seventeen, forty, wholes]) {
    let sum = 0;
    for (let turn = 0; turn < 300; turn++) { const list = born(turn); sum += list[0]! + list[list.length - 1]! + list.length; }
    console.log(born.name, sum, born(1).join());
}
