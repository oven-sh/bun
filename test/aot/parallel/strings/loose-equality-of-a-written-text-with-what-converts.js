// `x == "abc"` and `"abc" == x` with objects that convert by valueOf, toString and Symbol.toPrimitive, once each and in their order, one that throws, a symbol, a BigInt, a String object
const log = [];
function left(x) {
  return x == "abc";
}
function right(x) {
  return "abc" == x;
}
function tell(f, x) {
  try {
    return String(f(x));
  } catch (e) {
    return e.name;
  }
}
function deed() {
  const values = [
    "abc",
    new String("abc"),
    { valueOf() { log.push("valueOf"); return "abc"; }, toString() { log.push("toString"); return "no"; } },
    { valueOf() { log.push("object"); return {}; }, toString() { log.push("then text"); return "abc"; } },
    { [Symbol.toPrimitive](hint) { log.push(hint); return "abc"; } },
    { [Symbol.toPrimitive]() { log.push("throws"); throw new EvalError("no primitive"); } },
    ["abc"],
    Symbol("abc"),
    10n,
    NaN,
    null,
    undefined,
    Object.create(null),
  ];
  const out = [];
  for (let i = 0; i < values.length; i++) out.push(tell(left, values[i]) + "/" + tell(right, values[i]));
  return out.join(" ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
console.log(log.length, log.slice(0, 10).join());
