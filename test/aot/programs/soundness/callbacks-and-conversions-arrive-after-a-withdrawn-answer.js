// The callback, the thenable and the object with a conversion arrive only after the first answer about the construction is withdrawn: until then the nodes hold undefined or a number.
class C { constructor() { peek(this); this.k = "a"; } }
let key;
function peek(o) { key = o.k; }
function main() {
  const c = new C();
  const seen = [];
  for (let round = 0; round < 2; round++) {
    console.log("x".replace("x", { a: undefined, undefined: (m) => { seen.push(typeof m); return "late " + m; } }[key]));
    console.log("abc".indexOf({ a: 1, undefined: { toString() { seen.push("converted"); return "c"; } } }[key]));
    console.log(JSON.stringify({ v: 1 }, { a: undefined, undefined: (k, v) => { seen.push("replacer"); return v; } }[key]));
    console.log(Math.max({ a: 1, undefined: { valueOf() { seen.push("valueOf"); return 7; } } }[key], 2));
    const bound = Function.prototype.bind.call({ a: Math.abs, undefined: function () { seen.push("target"); return "called"; } }[key], null, -1);
    console.log(bound());
    peek(c);
  }
  console.log(seen.join());
}
main();
