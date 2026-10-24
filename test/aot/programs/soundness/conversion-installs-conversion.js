function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
let state = 0;
const p = { v: 1 };
const o = { toString() { p.valueOf = function () { state = "changed"; return 7; }; return "o"; } };
function use(tag) { const before = state; show(tag, p + 1); show(tag, "" + o); show(tag, p + 1); show(tag, state); show(tag, before); }
use("first");
use("second");
