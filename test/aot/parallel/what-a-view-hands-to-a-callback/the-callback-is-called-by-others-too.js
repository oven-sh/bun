// The function that a sort of a view calls is called by the program as well, with what is no element of the view.
const table = new Float64Array([0.5, 1.5, 2.5, 3.5]);
const said = [];
function compare(a, b) { said.push(`${typeof a} ${table[a]}`); return a < b ? -1 : a > b ? 1 : 0; }
new Int32Array([3, 1, 2]).sort(compare);
compare("1", 2);
compare(undefined, 2);
new Function("compare", "compare(1.5, 2); compare(2n, 3n); compare({ valueOf() { return 1; } }, 2);")(compare);
console.log(said.join());
