const above = require("./above.cjs");
const part = require("./part.cjs");
function own() {}
function run(made, text) { return made.constructor(text)(); }
console.log(typeof process.mainModule, above.twice(1), part.add(1));
console.log(run(own, "const list = process.mainModule.children; return [list.length, typeof list[0], list[0] === list[0], list[0] !== list[1], list.indexOf(list[1]), list.includes(process.mainModule), String(list[0]), Object.getPrototypeOf(list[0]) === Object.getPrototypeOf(process.mainModule), list[0].then, [...list].length].join(' ');"));
console.log(run(own, "const list = process.mainModule.children; return [delete list[0], list.length, 0 in list, typeof list.pop(), list.length].join(' ');"));
run(own, "return Promise.all(process.mainModule.children);").then(list => console.log(list.length));
