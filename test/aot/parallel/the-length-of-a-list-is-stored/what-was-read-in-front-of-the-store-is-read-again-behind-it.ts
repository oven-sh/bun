const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function around(list: number[], to: number): string { const before = list.length, first = list[2]; list.length = to >>> 0; return before + ":" + first + ":" + list.length + ":" + list[2] + ":" + (2 in list); }
console.log(around([1, 2, 3, 4], numbers[1]!), around([1.5, 2.5, 3.5], numbers[3]!), around([1, 2, 3], numbers[6]!));
