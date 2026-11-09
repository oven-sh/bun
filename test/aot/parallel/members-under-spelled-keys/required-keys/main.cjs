// CommonJS: keys that a required file hands out.
const { kept, word, Base } = require("./keys.cjs");
const own = Symbol("own");
class Child extends Base {
  [kept]() { return "child " + super[kept](); }
  [word]() { return "word"; }
  [own]() { return "own"; }
}
function ask(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const said = new Set();
  for (let i = 0; i < list.length; i++) said.add([list[i][kept](), typeof list[i][word], typeof list[i][own], list[i].plain()].join("|"));
  return [...said].join(" / ") + work;
}
const list = [];
for (let i = 0; i < 300; i++) list.push(i & 1 ? new Child() : new Base());
console.log(ask(list));
