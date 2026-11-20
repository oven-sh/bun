const makeTable = require("./index.js");
const table = makeTable();
const log = [];
table.under("/", (_, asked) => { asked.seen = (asked.seen || 0) + 1; });
table.get("/", () => "home");
table.get("/birds", () => "birds");
table.get("/birds/:name", p => "bird " + p.name);
table.put("/birds/:name", (p, asked) => "put " + p.name + asked.body.length);
table.get("/birds/:name/eggs/:number", p => (p.number > 5 ? undefined : p.name + "'s egg " + p.number));
table.get("/files/*", p => "file " + p.rest);
table.get("/a.b+c", () => "odd");
table.get("/:first/:second?", p => Object.keys(p).join() + " " + Object.values(p).join("-"));
const asks = [["get", "/"], ["get", "/birds"], ["get", "/birds/"], ["get", "/birds/owl"], ["put", "/birds/jay", "xyz"], ["get", "/birds/owl/eggs/3"], ["get", "/birds/owl/eggs/9"], ["get", "/files/a/b%20c/d"], ["get", "/files/"], ["get", "/a.b+c"], ["get", "/aXb+c"], ["get", "/x%41/"], ["put", "/none"], ["get", "/one/two/three"], ["get", ""]];
for (const [word, place, body] of asks) {
  const asked = { word, place, body };
  console.log(word, place, String(table(asked)), asked.seen);
}
try { table({ word: "get", place: "/birds/%zz" }); } catch (error) { console.log(error.constructor.name); }
let sum = 0;
for (let turn = 0; turn < 600; turn++) {
  const [word, place, body] = asks[turn % asks.length];
  const said = table({ word, place: turn % 5 ? place : place + "/n" + turn, body });
  sum = (sum * 31 + (said ? said.length : 7)) | 0;
}
console.log(sum, table.signs.map(sign => sign.found).join());
console.log(makeTable.compile("/:a/x:b?", true).expression.source, makeTable.compile("/*", false).names.join());
