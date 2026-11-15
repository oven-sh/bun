"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const kept = [];
for (let turn = 0; turn < 6 + more; turn++) {
  const keys = Object.keys(JSON.parse('{"alpha' + turn + '":1,"beta' + turn + '":2,"gamma' + turn + '":3,"delta' + turn + '":4}'));
  let lengths = 0;
  for (const key of keys) lengths += JSON.stringify(key).length;
  Bun.gc(true);
  for (const key of keys) kept.push(JSON.stringify(key));
  const filler = [];
  for (let i = 0; i < 20000; i++) filler.push(JSON.stringify("f" + i + turn));
  said.push(String(lengths), String(filler.length), kept.join(""));
}
console.log(said.join("\n"));
