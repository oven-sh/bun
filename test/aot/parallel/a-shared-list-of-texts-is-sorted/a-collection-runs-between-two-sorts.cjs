"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const kept = [];
for (let turn = 0; turn < 6 + more; turn++) { const record = JSON.parse('{"delta' + turn + '":1,"alpha' + turn + '":2,"charlie' + turn + '":3,"bravo' + turn + '":4}'); let lengths = 0; for (let i = 0; i < 3; i++) lengths += Object.keys(record).sort()[0].length; Bun.gc(true); kept.push(Object.keys(record).sort()); const filler = []; for (let i = 0; i < 20000; i++) filler.push(["f" + i, "e" + turn].sort()); said.push(String(lengths), String(filler.length), kept.map(keys => keys.join()).join(";")); }
console.log(said.join("\n"));
