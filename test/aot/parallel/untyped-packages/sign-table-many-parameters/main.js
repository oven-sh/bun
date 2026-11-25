const makeTable = require("./index.js");
const table = makeTable();
const letters = "abcdefghijklmnop".split("");
for (let many = 1; many <= 16; many += 3) {
  const names = letters.slice(0, many);
  table.get("/n" + many + "/" + names.map(name => ":" + name).join("/"), p => names.map(name => p[name]).join(",") + "#" + Object.keys(p).length);
}
table.get("/:year-:month-:day", p => +p.year * 10000 + +p.month * 100 + +p.day);
table.get("/:low..:high", p => (p.low > p.high ? undefined : p.low + " to " + p.high));
table.get("/:x/:x/:x", p => "last " + p.x);
table.get("/:constructor/:__proto__/:toString", p => [p.constructor, typeof p.toString].join());
table.get("/opt/:a?/:b?/:c?", p => JSON.stringify(p));
for (let many = 1; many <= 16; many++) console.log(many, table({ word: "get", place: "/n" + many + "/" + letters.slice(0, many).map((name, at) => name + at).join("/") }));
for (const place of ["/1987-05-23", "/1987-05", "/1..5", "/5..1", "/p/q/r", "/opt/1//3", "/opt///", "/opt/1/2/3/4", "/%E2%82%AC-1-2"]) console.log(place, String(table({ word: "get", place })));
let sum = 0;
for (let turn = 0; turn < 500; turn++) {
  const many = 1 + (turn % 6) * 3;
  const said = table({ word: "get", place: turn % 7 === 3 ? "/2000-" + (turn % 12) + "-" + (turn % 28) : "/n" + many + "/" + letters.slice(0, many).map(name => name + turn).join("/") });
  sum = (sum * 31 + String(said).length + (typeof said === "number" ? said : 0)) | 0;
}
console.log(sum, table.signs.map(sign => sign.found).join());
