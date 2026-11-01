// The keys of an object name files of the folder. The build knows how each name starts and ends, and takes every file between.
const table = { one: 1, two: 2 };
for (const name in table) console.log(require(`./part.${name}.cjs`).name);
let key;
for (key in table) console.log(require("./part." + key + ".cjs").name);
