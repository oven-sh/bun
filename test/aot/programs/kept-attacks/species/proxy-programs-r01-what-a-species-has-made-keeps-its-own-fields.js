// Species: proxy programs  what a species has made keeps its own fields. It prints what plain Bun prints.
const log = [];
class List extends Array { constructor(...a) { super(...a); this.tag = 1; this.note = "n"; } }
const list = new List(); list.push([1, [2]], [3], 4);
for (const made of [list.flat(), list.flat(2), list.slice(1), list.concat([5]), list.map(x => x), list.filter(x => x !== 4), list.splice(0, 1), list.flatMap(x => x)])
  log.push(made.constructor.name + ":" + made.tag + ":" + made.note + ":" + made.length + ":" + JSON.stringify(made) + ":" + Object.keys(made).join(""));
console.log(log.join("; "));
