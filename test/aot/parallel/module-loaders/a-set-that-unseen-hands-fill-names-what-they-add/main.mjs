// The Set goes through a function that the build does not follow to its end, which adds a path made at run time. Statements import both files and strings spell them, so the load finds each by its name.
import "./parts/north.mjs";
import "./parts/south.mjs";
const unseen = x => [x][JSON.parse("0")];
const names = new Set(["./parts/north.mjs"]);
unseen(held => held.add(["./parts", "south.mjs"].join("/")))(names);
const spelled = "./parts/south.mjs";
const lines = [];
for (const name of names) lines.push((await import(name)).label);
console.log(lines.join(), spelled.length);
