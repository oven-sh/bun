// An inner loop adds a module's variable to a sum each turn and sets it from a local of the outer loop; the last turn of the inner loop makes that local a text.
const hook = globalThis[process.argv[5] ?? "isNaN"];
const n = Number(process.argv[2] ?? "3"), k = Number(process.argv[3] ?? "5"), m = Number(process.argv[4] ?? "4");
let a = 0;
function f(n, k, m) {
  let s = 0, y = 0;
  for (let o = 0; o < n; o++) {
    const x = y; y = 0;
    for (let j = 0; j < k; j++) {
      s = s + a;
      if (j > 1) a = x;
      y = (y + 1) | 0;
      if (j === m) { hook(j); y = "w"; }
    }
  }
  return s;
}
console.log(f(n, k, m) === "0wwwwwww" ? "ok" : "wrong");
