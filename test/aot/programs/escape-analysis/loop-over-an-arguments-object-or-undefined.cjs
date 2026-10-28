// One function walks either an arguments object or undefined by index. Its caller makes the arguments object and catches what the walk of undefined throws.
function show(r, depth = 0) {
  if (r === undefined) return "undefined";
  switch (typeof r) {
    case "number": return Object.is(r, -0) ? "-0" : String(r);
  }
  try {
    let indexed = "";
    for (const k of Reflect.ownKeys(r)) if (typeof k === "string" && (k === "length" || String(k >>> 0) === k)) { const d = Reflect.getOwnPropertyDescriptor(r, k); indexed += " " + k + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }
    return indexed;
  } catch (e) { return "cannot be shown: " + e.name; }
}
function sum(which, given) { const v = which === 0 ? given : undefined; let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s; }
function trySum(v) { try { return show(sum(v, (function () { return arguments; })(1, 2, 3))); } catch (e) { return "threw " + e.name; } }
let last = ""; for (let n = 0; n < 20; n++) last = trySum(0);
console.log("of the arguments:", last);
for (let n = 0; n < 3; n++) console.log("of undefined:", trySum(1));
console.log("of the arguments again:", trySum(0));
