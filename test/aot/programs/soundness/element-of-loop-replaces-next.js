function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
let i = 0;
const iterator = { next() { return { done: i++ >= 2, value: element }; } };
const element = { go() { iterator.next = function () { return { done: i++ >= 4, value: "late" }; }; } };
const iterable = { [Symbol.iterator]() { return iterator; } };
for (const x of iterable) {
  show("element", x);
  if (typeof x === "object") x.go();
}
i = 0;
for (const x of iterable) show("again", x);
