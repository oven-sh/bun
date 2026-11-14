// A version of the loop takes views where the store of its iterations expected an array.
const define = (name, value) => { globalThis[name] = value; };
define(["ma", "kes"].join(""), [() => [1, 2, 3], () => [0.5, , 1.5], () => new Uint8Array(3), () => Buffer.alloc(4), () => new Float64Array(3), () => "abc", () => ({})]);
define(["rows", "Made"].join(""), () => [[1.5], [2], [3], [4]]);
function add(l, m, rows) { let s = 0; for (let i = 1; i < l.length; i++) { const w = rows[i]; s += rows[0][0]; m[i] = s; } return s; }
for (let a = 0; a < 5; a++) {
  for (let b = 0; b < 7; b++) {
    const m = makes[b]();
    console.log(add(makes[a](), m, rowsMade()), JSON.stringify(m));
  }
}
