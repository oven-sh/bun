class First extends Promise { who() { return "first"; } }
class Second extends First { who() { return "second"; } }
const a = Second.resolve(1);
const b = Promise.resolve.call(First, 2);
const c = a.then(x => x);
console.log(a.who(), b.who(), c.who(), b instanceof Second, b.constructor.name);
b.then(x => console.log(x));
