function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
const inner = { w: 2 };
const outer = { then(res) { inner.then = function (r) { delete inner.then; r("late"); }; res(inner); } };
async function main() { show("plain", await inner); show("outer", await outer); show("plain again", await inner); }
main();
