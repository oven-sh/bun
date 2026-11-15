const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function both(list: (number | string)[], less: number, more: number): string { list.length = less >>> 0; list.length = more >>> 0; return JSON.stringify(list); }
console.log(both([1, 2, 3, 4], numbers[1]!, numbers[4]!), both([1.5, 2.5, 3.5], numbers[0]!, numbers[2]!), both(["a", "b", "c"], numbers[2]!, numbers[3]!));
