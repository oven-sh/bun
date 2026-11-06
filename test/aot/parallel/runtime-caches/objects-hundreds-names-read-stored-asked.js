// Ordinary objects with 129 to 5,000 names, which are dictionaries: names that are there, that are not, that were deleted, that came back, getters, values that may not be written,
// names above the object. Each is read, stored and asked for by key and by name, the first time and warm.
const box = JSON.parse("[null]");
function hide(x) { box[0] = x; return box[0]; }
const lines = [];
function readKey(o, k) { return o[k]; }
function storeKey(o, k, v) { o[k] = v; }
function hasKey(o, k) { return k in o; }
function ownKey(o, k) { return Object.hasOwn(o, k); }
function readK3(o) { return o.k3; }
function readK127(o) { return o.k127; }
function readLast(o) { return o.last; }
function readNowhere(o) { return o.nowhere; }
function storeK3(o, v) { o.k3 = v; }
function storeLast(o, v) { o.last = v; }
function hasK3(o) { return "k3" in o; }
function hasNowhere(o) { return "nowhere" in o; }
function show(v) { return typeof v === "object" && v !== null ? "object" : String(v); }

function make(size, how) {
  let o;
  if (how === "parsed") {
    let text = "{";
    for (let i = 0; i < size; i++) text += (i ? "," : "") + JSON.stringify("k" + i) + ":" + i;
    o = JSON.parse(hide(text + "}"));
  } else {
    o = how === "bare" ? Object.create(null) : JSON.parse(hide("{}"));
    o = hide(o);
    for (let i = 0; i < size; i++) o["k" + i] = i;
  }
  o = hide(o);
  o.last = "last";
  return o;
}
function sweep(title, o, size) {
  let sum = 0, present = 0, own = 0, absent = 0;
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < size + 40; i++) {
      const k = hide("k" + i), v = readKey(o, k);
      if (v === undefined) absent++; else sum += typeof v === "number" ? v : 1;
      if (hasKey(o, k)) present++;
      if (ownKey(o, k)) own++;
      if (readKey(o, hide("x" + i)) !== undefined || hasKey(o, hide("y" + i))) sum = NaN;
    }
  }
  lines.push([title, "sum", sum, "present", present, "own", own, "absent", absent, "keys", Object.keys(o).length].join(" "));
}
function warm(title, o) {
  let text = "";
  for (let turn = 0; turn < 40; turn++) {
    const now = [readK3(o), readK127(o), readLast(o), readNowhere(o), hasK3(o), hasNowhere(o), readKey(o, "k3"), readKey(o, "k128"), readKey(o, "nowhere"), readKey(o, "toString") === Object.prototype.toString,
      hasKey(o, "k64"), hasKey(o, "valueOf"), ownKey(o, "valueOf"), ownKey(o, "last")].map(show).join(" ");
    if (turn && now !== text) lines.push(title + ": CHANGED AT TURN " + turn);
    text = now;
  }
  lines.push(title + ": " + text);
}
function stores(title, o, size) {
  const refused = [];
  for (let turn = 0; turn < 20; turn++) {
    for (const i of [3, 64, 127, 128, size - 1]) {
      try { storeKey(o, hide("k" + i), turn * 1000 + i); } catch (e) { if (!turn) refused.push("k" + i + " " + e.constructor.name); }
    }
    try { storeK3(o, turn); } catch (e) { if (!turn) refused.push("k3 by name " + e.constructor.name); }
    try { storeLast(o, "last " + turn); } catch (e) { if (!turn) refused.push("last " + e.constructor.name); }
  }
  lines.push(title + ": refused " + refused.join(", "));
}
let ran = 0;
for (const size of [129, 200, 255, 256, 257, 300, 1000, 5000]) {
  for (const how of ["parsed", "stored", "bare"]) {
    const name = size + " " + how;
    const o = make(size, how);
    sweep(name + " new", o, size); warm(name + " new", o);
    stores(name + " stores", o, size); sweep(name + " stored", o, size); warm(name + " stored", o);
    delete o.k3; delete o[hide("k128")]; delete o[hide("k" + (size - 1))];
    sweep(name + " three deleted", o, size); warm(name + " three deleted", o);
    stores(name + " stores again", o, size); sweep(name + " back", o, size); warm(name + " back", o);
    Object.defineProperty(o, "k3", { get() { ran++; return "got"; }, set(v) { ran += 100; }, enumerable: true, configurable: true });
    Object.defineProperty(o, "k127", { value: "fixed", writable: false, enumerable: true, configurable: true });
    Object.defineProperty(o, hide("k64"), { value: "hidden", writable: true, enumerable: false, configurable: true });
    sweep(name + " other forms", o, size); warm(name + " other forms", o);
    stores(name + " stores to other forms", o, size); warm(name + " after those", o);
    const below = hide(Object.create(o));
    below.own = 1;
    sweep(name + " from below", below, size); warm(name + " from below", below);
    stores(name + " stores below", below, size); warm(name + " below after stores", below); warm(name + " above after stores", o);
    Bun.gc(true);
    warm(name + " after a collection", o);
    Object.freeze(o);
    stores(name + " frozen", o, size); warm(name + " frozen", o); sweep(name + " frozen", o, size);
  }
}
lines.push("accessors ran " + ran);
console.log(lines.join("\n"));
