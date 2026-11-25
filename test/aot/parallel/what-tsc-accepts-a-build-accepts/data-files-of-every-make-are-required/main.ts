import namedDefault = require("./named-default.json");
import emptyRecord = require("./empty-record.json");
import emptyList = require("./empty-list.json");
import nothing = require("./nothing.json");
import yes = require("./yes.json");
import lists = require("./lists.json");
import records = require("./records.json");
import deep = require("./deep.json");
import again = require("./records.json");

const five: number = namedDefault.default;
const one: number = namedDefault.a;
const none: null = nothing;
const flag: boolean = yes;
const three: number = lists[1][0];
const names: string[] = records.map(record => record.name);
const tags: number = records.reduce((count, record) => count + record.tags.length, 0);
const last: number = deep.deep.deeper.list[1];
const text: string = deep.length;
console.log("SAID", five, one, none, flag, three, names.join(), tags, last, text, deep.then);
console.log("SAID", Object.keys(emptyRecord).length, emptyList.length, Object.keys(namedDefault).join(), again === records);
records.push({ name: "c", tags: ["y", "z"] });
lists[0].length = 0;
console.log("SAID", again.length, again[2].tags.join(), JSON.stringify(lists));
function total(rows: number[][]): number {
  let sum = 0;
  for (const row of rows) for (const cell of row) sum += cell;
  return sum;
}
let sum = 0;
for (let round = 0; round < 1000; round++) sum += total(lists) + deep.deep.deeper.list[0];
console.log("SAID", sum);
