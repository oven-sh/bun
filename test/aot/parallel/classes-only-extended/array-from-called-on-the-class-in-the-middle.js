class First extends Array { who() { return "first"; } }
class Second extends First { who() { return "second"; } }
const a = Second.from([1, 2]);
const b = Array.from.call(First, [3, 4]);
const c = First.of(5, 6);
console.log(a.who(), a.join(), b.who(), b.join(), c.who(), c.join(), b instanceof Second, c.constructor.name);
