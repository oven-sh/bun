// Contiguous storage of an array takes every value, and turns into another kind only where the engine makes it sparse or slow. Every case does that, or comes close to it, by another door, and then reads, pushes and pops: no store under an index, which would cost the array the proofs that the case is after.
const far = Date.now() > 0 ? 150000 : 1;
const many = []; for (let k = 0; k < 3000; k++) many.push("m");
function text(v) { return v === undefined ? "undefined" : typeof v === "object" ? "#" + v.id : String(v); }
function shiftIt(list) { list.shift(); }
function freezeIt(list) { Object.freeze(list); }
function structuredCloneOrNot(list) { return typeof structuredClone === "function" ? structuredClone(list) : list; }
const lines = [];
function run(name, f) { try { lines.push(name + ": " + f()); } catch (error) { lines.push(name + ": threw " + error.name); } }
function f1() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | nothing", f1);
function f2() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.freeze(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | freeze", f2);
function f3() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.seal(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | seal", f3);
function f4() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.preventExtensions(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | prevent extensions", f4);
function f5() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.defineProperty(a, 2, { get() { return "z"; }, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | accessor at an index", f5);
function f6() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.defineProperty(a, 2, { value: "z", writable: false, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | read-only index", f6);
function f7() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.defineProperty(a, "length", { writable: false });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | read-only length", f7);
function f8() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: "z" });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | another prototype", f8);
function f9() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.setPrototypeOf(a, Object.create(Array.prototype, { 9: { set(v) { seen = v; }, get() { return "z"; } } }));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | prototype with a setter", f9);
function f10() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  heir = Object.create(a); heir[1] = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | becomes a prototype", f10);
function f11() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a[200000] = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | store far above", f11);
function f12() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a[4000000000] = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | store very far above", f12);
function f13() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a[far] = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | store far above by variable", f13);
function f14() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.length = 200000;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | length far above", f14);
function f15() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.length = 4294967295;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | length at the limit", f15);
function f16() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.length = 200000; a.length = 8;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | length far above and back", f16);
function f17() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | shift of a long array", f17);
function f18() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  a.unshift("z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | unshift of a long array", f18);
function f19() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  a.splice(1, 1);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | splice out of a long array", f19);
function f20() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  a.splice(1, 0, "z", "z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | splice into a long array", f20);
function f21() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | shift of a short array", f21);
function f22() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.unshift("z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | unshift of a short array", f22);
function f23() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.splice(1, 1, "z", "z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | splice of a short array", f23);
function f24() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  Array.prototype.shift.call(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | shift through call", f24);
function f25() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  shiftIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | shift in a callee", f25);
function f26() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push("p" + k);
  const b = a; b.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | shift through an alias", f26);
function f27() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  while (a.length) a.pop(); a.push("z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | pop to empty, push", f27);
function f28() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.length = 0; a.push("z", "z");
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | emptied, push", f28);
function f29() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.reverse();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | reverse", f29);
function f30() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.sort((x, y) => (String(x.id ?? x) < String(y.id ?? y) ? 1 : -1));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | sort", f30);
function f31() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.fill("z", 2, 5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | fill", f31);
function f32() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.copyWithin(0, 4);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | copyWithin", f32);
function f33() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.label = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | named property", f33);
function f34() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a[-1] = "z";
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | negative name", f34);
function f35() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  delete a[3];
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | delete", f35);
function f36() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  JSON.stringify(a); Array.from(a); new Set(a); a.join(); a.includes("z"); a.indexOf("z"); a.slice(1); a.concat(a); structuredCloneOrNot(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | handed to natives", f36);
function f37() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  a.push(...many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | push of many", f37);
function f38() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Array.prototype.push.apply(a, many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | push applied", f38);
function f39() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  Object.freeze(new Proxy(a, {}));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | through a proxy", f39);
function f40() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  freezeIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | frozen in a callee", f40);
function f41() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push("p" + k);
  const o = { list: a }; Object.freeze(o.list);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push("z"); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("texts | frozen through a holder", f41);
function f42() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | nothing", f42);
function f43() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.freeze(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | freeze", f43);
function f44() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.seal(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | seal", f44);
function f45() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.preventExtensions(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | prevent extensions", f45);
function f46() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.defineProperty(a, 2, { get() { return { id: -1 }; }, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | accessor at an index", f46);
function f47() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.defineProperty(a, 2, { value: { id: -1 }, writable: false, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | read-only index", f47);
function f48() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.defineProperty(a, "length", { writable: false });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | read-only length", f48);
function f49() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: { id: -1 } });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | another prototype", f49);
function f50() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.setPrototypeOf(a, Object.create(Array.prototype, { 9: { set(v) { seen = v; }, get() { return { id: -1 }; } } }));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | prototype with a setter", f50);
function f51() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  heir = Object.create(a); heir[1] = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | becomes a prototype", f51);
function f52() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a[200000] = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | store far above", f52);
function f53() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a[4000000000] = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | store very far above", f53);
function f54() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a[far] = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | store far above by variable", f54);
function f55() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.length = 200000;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | length far above", f55);
function f56() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.length = 4294967295;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | length at the limit", f56);
function f57() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.length = 200000; a.length = 8;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | length far above and back", f57);
function f58() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | shift of a long array", f58);
function f59() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  a.unshift({ id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | unshift of a long array", f59);
function f60() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  a.splice(1, 1);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | splice out of a long array", f60);
function f61() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  a.splice(1, 0, { id: -1 }, { id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | splice into a long array", f61);
function f62() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | shift of a short array", f62);
function f63() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.unshift({ id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | unshift of a short array", f63);
function f64() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.splice(1, 1, { id: -1 }, { id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | splice of a short array", f64);
function f65() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  Array.prototype.shift.call(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | shift through call", f65);
function f66() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  shiftIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | shift in a callee", f66);
function f67() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push({ id: k });
  const b = a; b.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | shift through an alias", f67);
function f68() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  while (a.length) a.pop(); a.push({ id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | pop to empty, push", f68);
function f69() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.length = 0; a.push({ id: -1 }, { id: -1 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | emptied, push", f69);
function f70() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.reverse();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | reverse", f70);
function f71() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.sort((x, y) => (String(x.id ?? x) < String(y.id ?? y) ? 1 : -1));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | sort", f71);
function f72() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.fill({ id: -1 }, 2, 5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | fill", f72);
function f73() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.copyWithin(0, 4);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | copyWithin", f73);
function f74() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.label = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | named property", f74);
function f75() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a[-1] = { id: -1 };
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | negative name", f75);
function f76() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  delete a[3];
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | delete", f76);
function f77() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  JSON.stringify(a); Array.from(a); new Set(a); a.join(); a.includes({ id: -1 }); a.indexOf({ id: -1 }); a.slice(1); a.concat(a); structuredCloneOrNot(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | handed to natives", f77);
function f78() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  a.push(...many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | push of many", f78);
function f79() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Array.prototype.push.apply(a, many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | push applied", f79);
function f80() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  Object.freeze(new Proxy(a, {}));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | through a proxy", f80);
function f81() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  freezeIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | frozen in a callee", f81);
function f82() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push({ id: k });
  const o = { list: a }; Object.freeze(o.list);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push({ id: -1 }); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("objects | frozen through a holder", f82);
function f83() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | nothing", f83);
function f84() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.freeze(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | freeze", f84);
function f85() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.seal(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | seal", f85);
function f86() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.preventExtensions(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | prevent extensions", f86);
function f87() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.defineProperty(a, 2, { get() { return 1.5; }, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | accessor at an index", f87);
function f88() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.defineProperty(a, 2, { value: 1.5, writable: false, configurable: true, enumerable: true });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | read-only index", f88);
function f89() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.defineProperty(a, "length", { writable: false });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | read-only length", f89);
function f90() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: 1.5 });
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | another prototype", f90);
function f91() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.setPrototypeOf(a, Object.create(Array.prototype, { 9: { set(v) { seen = v; }, get() { return 1.5; } } }));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | prototype with a setter", f91);
function f92() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  heir = Object.create(a); heir[1] = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | becomes a prototype", f92);
function f93() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a[200000] = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | store far above", f93);
function f94() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a[4000000000] = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | store very far above", f94);
function f95() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a[far] = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | store far above by variable", f95);
function f96() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.length = 200000;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | length far above", f96);
function f97() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.length = 4294967295;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | length at the limit", f97);
function f98() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.length = 200000; a.length = 8;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | length far above and back", f98);
function f99() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | shift of a long array", f99);
function f100() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  a.unshift(1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | unshift of a long array", f100);
function f101() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  a.splice(1, 1);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | splice out of a long array", f101);
function f102() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  a.splice(1, 0, 1.5, 1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | splice into a long array", f102);
function f103() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | shift of a short array", f103);
function f104() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.unshift(1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | unshift of a short array", f104);
function f105() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.splice(1, 1, 1.5, 1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | splice of a short array", f105);
function f106() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  Array.prototype.shift.call(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | shift through call", f106);
function f107() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  shiftIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | shift in a callee", f107);
function f108() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 12000; k++) a.push(k % 2 ? "p" + k : k);
  const b = a; b.shift();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | shift through an alias", f108);
function f109() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  while (a.length) a.pop(); a.push(1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | pop to empty, push", f109);
function f110() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.length = 0; a.push(1.5, 1.5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | emptied, push", f110);
function f111() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.reverse();
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | reverse", f111);
function f112() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.sort((x, y) => (String(x.id ?? x) < String(y.id ?? y) ? 1 : -1));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | sort", f112);
function f113() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.fill(1.5, 2, 5);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | fill", f113);
function f114() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.copyWithin(0, 4);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | copyWithin", f114);
function f115() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.label = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | named property", f115);
function f116() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a[-1] = 1.5;
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | negative name", f116);
function f117() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  delete a[3];
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | delete", f117);
function f118() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  JSON.stringify(a); Array.from(a); new Set(a); a.join(); a.includes(1.5); a.indexOf(1.5); a.slice(1); a.concat(a); structuredCloneOrNot(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | handed to natives", f118);
function f119() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  a.push(...many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | push of many", f119);
function f120() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Array.prototype.push.apply(a, many);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | push applied", f120);
function f121() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  Object.freeze(new Proxy(a, {}));
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | through a proxy", f121);
function f122() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  freezeIt(a);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | frozen in a callee", f122);
function f123() {
  let seen, heir;
  const a = [];
  for (let k = 0; k < 8; k++) a.push(k % 2 ? "p" + k : k);
  const o = { list: a }; Object.freeze(o.list);
  let s = a.length + "|";
  let n = 0;
  for (let i = 0; i < a.length && i < 20000; i++) { const v = a[i]; n += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += n + "|";
  let m = 0, turns = 0;
  for (const v of a) { if (++turns > 20000) break; m += v === undefined ? 1000 : typeof v === "object" ? v.id + 1 : typeof v === "string" ? v.length : v; }
  s += m + "|" + text(a[0]) + "," + text(a[2]) + "," + text(a[3]) + "," + text(a[9]) + "," + text(a[a.length - 1]);
  try { a.push(1.5); s += "|pushed " + a.length; } catch (error) { s += "|push threw " + error.name; }
  try { s += "|popped " + text(a.pop()) + " " + a.length; } catch (error) { s += "|pop threw " + error.name; }
  return s + "|" + text(seen) + "|" + (heir ? text(heir[0]) + text(heir[1]) : "");
}
run("mixed | frozen through a holder", f123);
console.log(lines.join("\n"));
