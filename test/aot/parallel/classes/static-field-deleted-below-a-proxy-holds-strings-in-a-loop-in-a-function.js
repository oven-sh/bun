// A static field that was deleted while a Proxy stood above its class is defined anew through the trap. A loop that reads and stores the field afterwards finds what it stored, where it holds strings.
let current, notes = [];
class S { static a = 7; static k = 1; static b = 9; }
function make() { return S; }
function keep(o) { current = o; return o; }
function show(x) { return typeof x === "string" ? JSON.stringify(x) : String(x); }
function note(...seen) { for (const each of seen) notes.push(show(each)); }
function leave() { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete o.k; S.k = 5; }
function grow() { const o = keep(make()); S.k = "a"; for (let i = 0; i < 6; i++) { S.k = S.k + "b"; note(o.k); } }
leave();
grow();
console.log(notes.join(" "));
