function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
let closed = 0;
const iterator = { next() { return { done: false, get value() { iterator.return = function () { closed = "closed"; return {}; }; return 1; } }; } };
const iterable = { [Symbol.iterator]() { return iterator; } };
for (const x of iterable) { show("x", x); break; }
show("closed", closed);
