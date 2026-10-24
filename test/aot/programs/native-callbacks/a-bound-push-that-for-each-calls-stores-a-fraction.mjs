// The list is a literal of integers. forEach calls `push`, bound to the list, with a fraction, an index and an array, and the program reads the fraction back.
const list = [1, 2, 3];
[1.5].forEach(list.push.bind(list));
console.log(list[3] * 2, list[3] + 1, list[3], list[3] === 1.5, list[4], list.length);
