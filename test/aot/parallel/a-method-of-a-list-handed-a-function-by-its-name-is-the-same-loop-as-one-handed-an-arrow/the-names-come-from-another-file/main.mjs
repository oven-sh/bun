// The names are imported: by name, under another name, as the default, off a namespace, and one binding that the other file stores anew.
import half, { twice, big as large, add, chosen, choose } from "./functions.mjs";
import * as all from "./functions.mjs";
const rows = JSON.parse('[{"qty":1},{"qty":2},{"qty":3},{"qty":4}]');
const work = rows => [rows.map(twice).filter(large).reduce(add, 0), rows.map(half).filter(large).reduce(add, 0), rows.map(all.twice).filter(all.big).reduce(all.add, 0), rows.map(twice).filter(chosen).join()].join(" ");
const works = new Map([["work", work]]);
for (let turn = 0; turn < 4; turn++) { if (turn === 2) choose(value => value < 5); console.log(works.get(JSON.parse('"work"'))(rows)); }
