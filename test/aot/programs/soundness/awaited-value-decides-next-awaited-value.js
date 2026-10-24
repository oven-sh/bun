function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
const table = { a: { next: "b", v: 1 }, b: { next: "c", then(res) { res({ next: "c", v: "late" }); } }, c: { next: null, v: 3n } };
async function main() { let k = "a"; while (k) { const r = await table[k]; show(k, r.v); k = r.next; } }
main();
