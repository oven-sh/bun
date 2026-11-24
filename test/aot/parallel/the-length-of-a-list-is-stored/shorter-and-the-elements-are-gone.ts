const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function cut(list: number[], to: number): string { list.length = to >>> 0; return list.length + ":" + list.join() + ":" + (3 in list) + ":" + list[3]; }
console.log(cut([1.5, 2.5, 3.5, 4.5, 5.5], numbers[2]!), cut([1, 2, 3, 4, 5], numbers[4]!), cut([1, 2, 3, 4, 5], numbers[0]!));
const words = ["a", "b", "c", "d", "e"]; function trim(to: number) { words.length = to >>> 0; } trim(numbers[3]!); words.push("z"); console.log(words.join(), words.length);
