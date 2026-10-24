// The list is a literal of the integers 1 to 3. forEach calls `unshift`, bound to the list, with 1000, and the program compares what lies in front.
const list = [1, 2, 3];
[1000].forEach(list.unshift.bind(list));
console.log(list[0], list[0] === 1000, list[0] > 3, list.length);
