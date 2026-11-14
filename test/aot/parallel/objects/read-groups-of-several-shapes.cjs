// Reads of several names off records of which nothing is known: one shape, two and seven in turn, wide records, names beside fields, missing names, getters, dictionaries.
const turns = JSON.parse("40");
const wide = '"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,';
const texts = {
  one: ['{"id":#,"age":4,"score":5}'],
  two: ['{"id":#,"age":4,"score":5}', '{"score":2,"age":7,"id":#}'],
  seven: ['{"id":#,"age":4,"score":5}', '{"score":2,"age":7,"id":#}', '{"x":1,"score":2,"age":7,"id":#}', '{"y":1,"score":2,"age":7,"id":#}', '{"z":1,"score":2,"age":7,"id":#}', '{"age":1,"score":2,"id":#}', '{"w":0,"age":1,"score":2,"id":#}'],
  wide: ["{" + wide + '"id":#,"age":4,"score":5}', "{" + wide + '"score":2,"age":7,"id":#}'],
  missing: ['{"id":#,"age":4}', '{"id":#,"age":4,"score":5}', '{"score":1}'],
  mixed: ['{"id":#,"age":"four","score":null}', '{"id":"#","age":4.5,"score":true}'],
};
class P { constructor(i) { this.id = i; } get late() { return this.id; } }
class Q { constructor(i) { this.name = "q"; this.id = i; } }
const lists = {};
for (const name in texts) { lists[name] = []; for (let i = 0; i < 24; i++) lists[name].push(JSON.parse(texts[name][i % texts[name].length].replace("#", i))); }
lists.beside = []; lists.getters = []; lists.dictionaries = []; lists.others = [];
for (let i = 0; i < 24; i++) {
  const beside = i % 2 ? new P(i) : new Q(i); for (const key of ["age", "score"]) beside[key] = i % 7; lists.beside.push(beside);
  lists.getters.push(i % 3 ? { id: i, get age() { return i * 2; }, score: 4 } : Object.create({ age: 1, score: 9 }, { id: { value: i, enumerable: true } }));
  const dictionary = JSON.parse('{"id":1,"x":2,"age":3,"score":4}'); delete dictionary.x; dictionary.id = i; lists.dictionaries.push(dictionary);
  lists.others.push(i % 4 === 0 ? [i] : i % 4 === 1 ? "text" : i % 4 === 2 ? new Proxy({ id: i, age: 2, score: 3 }, {}) : Object.assign(() => i, { id: i, age: 1 }));
}
function read(list) { let sum = 0, text = ""; for (const u of list) { const id = u.id, age = u.age, score = u.score; sum += (typeof id === "number" ? id : 1) + (typeof age === "number" ? age : 2); if (score > 3) sum += score; text += typeof id + typeof score; } return sum + text.length; }
function sums(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].id * 2 + list[i].age; return sum; }
const said = [];
for (let turn = 0; turn < turns; turn++) {
  for (const name in lists) said.push(read(lists[name]) + ":" + sums(lists[name]));
  if (turn === 20) { lists.one[3].age = { valueOf() { return 100; } }; delete lists.two[4].score; lists.wide[5].extra = 1; Object.defineProperty(lists.seven[6], "age", { get() { return 50; } }); lists.beside[7].age = "seven"; }
}
let hash = 0; for (const c of said.join()) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.slice(0, 10).join(" "), said.slice(-10).join(" "));
