// an index is compared with the length, the program asks for the opposite, and the element is read on the side on which the index lies outside
function subject(list: number[], i: number) { if (i < 0) return -3; if (!(i < list.length)) return list[i] === undefined ? -1 : -2; return list[i]; }
function deed(list: number[], i: number) { return String(subject(list, i)); }
const numbers = [10, 11, 12];
console.log(deed(numbers, 0), deed(numbers, 2), deed(numbers, 3), deed(numbers, 4000), deed(numbers, -1));
let sum = 0;
for (let i = 0; i < 300; i++) sum += subject(numbers, i % 7);
console.log(String(sum));
console.log(deed(JSON.parse("[1, 2]"), JSON.parse("2")), deed(JSON.parse("[]"), JSON.parse("0")));
