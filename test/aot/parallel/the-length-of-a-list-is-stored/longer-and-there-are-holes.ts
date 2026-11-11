const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function stretch(list: number[], to: number): string { list.length = to >>> 0; return list.length + ":" + (2 in list) + ":" + list[2] + ":" + Object.keys(list).join(); }
console.log(stretch([1.5, 2.5], numbers[5]!), stretch([1, 2], numbers[6]!), stretch([], numbers[7]!));
const far: number[] = [1, 2, 3]; function reach(to: number) { far.length = to >>> 0; } reach(numbers[8]!); far[numbers[8]! - 1] = 9; console.log(far.length, far[69999], far.indexOf(9), 500 in far);
