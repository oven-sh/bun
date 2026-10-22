function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
let sent = 1;
function* g() { let got = yield () => { sent = "late"; }; show("got", got); got = yield 0; show("got", got); }
const it = g();
const f = it.next().value;
it.next(sent);
f();
it.next(sent);
