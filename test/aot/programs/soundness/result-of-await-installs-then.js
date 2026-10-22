function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
const o = { v: 1, go() { o.then = function (res) { res("late"); }; } };
async function main() {
  const r = await o;
  show("first", r);
  r.go();
  show("second", await o);
}
main();
