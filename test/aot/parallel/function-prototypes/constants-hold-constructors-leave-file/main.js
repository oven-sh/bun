// Constants that hold constructors and leave the file.
import Default, { Maker, Shown, makeLocal, hear } from "./maker.js";
let line = "";
for (let i = 0; i < 200; i++) line = JSON.stringify([new Maker(i), new Shown(i), new Default(i), makeLocal(i), hear({}, i)]);
console.log(line, new Maker(1) instanceof Maker, makeLocal(1).constructor.name);
