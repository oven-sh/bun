// map, whose rows all name one function of the library, is called under another name in a loop, and the list that it gives comes round the loop
const map = Array.prototype.map;
function deed(from: number[], turns: number) { let list: number[] = from; for (let i = 0; i < turns; i++) list = map.call(list, (v: number) => v + 1) as number[]; return list.join() + " " + Array.isArray(list) + " " + (list === from); }
console.log(deed([1, 2], 0));
console.log(deed([1, 2], 1));
console.log(deed([1, 2], 3));
console.log(deed([], 2));
