// NaN, Infinity, -1 and 1.5 are numbers, and an object may have fields of those names: a store under such a number is a store to the field.
const table = { first: 1, NaN: 2, Infinity: 3, "-Infinity": 4, "-1": 5, "1.5": 6, "1e+21": 7, "0": 8, "-0": 9, "01": 10 };
function lay(at, what) { table[at] = what; }
function read() { return [table.first, table.NaN, table.Infinity, table["-Infinity"], table["-1"], table["1.5"], table["1e+21"], table[0], table["-0"], table["01"]]; }
const said = [read().join()];
for (const at of [NaN, Infinity, -Infinity, -1, 1.5, 1e21, 0, -0, 1]) {
    lay(at, "laid under " + at);
    said.push(read().join());
}
console.log(said.join("\n"), Object.keys(table).join());
