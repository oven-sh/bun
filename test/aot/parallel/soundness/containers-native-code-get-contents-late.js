// An array, a map or a promise reaches code nobody sees. Its contents arrive later, or a method that changes it is called on a hidden value before the container is hidden.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
let stash;
const box = new Proxy({}, { set(target, key, value) { stash = value; return true; }, get() { return stash; } });
function hide(value) { box.kept = value; return box.kept; }
// `seen` is undefined at run time: the field is read through a leak of `this` before its store. An analysis learns that late, and only then finds the member `undefined`.
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();

// 1: reversed through a value that is hidden late
{ const list = [1, "two"]; function reverse(t) { t.reverse(); } reverse(hide([0])); const table = { early() { return [0]; }, undefined() { return hide(list); } }; reverse(table[seen]()); show("1", typeof list[0], typeof list[1], list[0], list[1]); }
// 2: pushed to
{ const list = [1]; function add(t) { t.push({ k: "v" }); } add(hide([0])); const table = { early() { return [0]; }, undefined() { return hide(list); } }; add(table[seen]()); show("2", list.length, typeof list[1], list[1] && list[1].k); }
// 3: filled
{ const list = [1, 2]; function fill(t) { t.fill("s"); } fill(hide([0])); const table = { early() { return [0]; }, undefined() { return hide(list); } }; fill(table[seen]()); show("3", typeof list[0], typeof list[1]); }
// 4: cut by a store to length
{ const list = [1, 2, 3]; function cut(t) { t.length = 0; } cut(hide([9])); const table = { early() { return [9]; }, undefined() { return hide(list); } }; cut(table[seen]()); show("4", list.length, typeof list[0]); }
// 5: an element arrives late in a hidden array
{ const inner = { v: 1 }; const list = []; const u = hide(list); const table = { early() {}, undefined() { list.push(inner); } }; table[seen](); u[0].v = "s"; show("5", typeof inner.v); }
// 6: a value arrives late in a hidden map
{ const inner = { v: 1 }; const map = new Map(); const u = hide(map); const table = { early() {}, undefined() { map.set("k", inner); } }; table[seen](); u.get("k").v = "s"; show("6", typeof inner.v); }
// 7: a member arrives late in a hidden set
{ const inner = { v: 1 }; const set = new Set(); const u = hide(set); const table = { early() {}, undefined() { set.add(inner); } }; table[seen](); for (const member of u) member.v = "s"; show("7", typeof inner.v); }
// 8: a hidden promise is resolved late
{ const inner = { v: 1 }; let resolve; const promise = new Promise(r => { resolve = r; }); const u = hide(promise); const done = u.then(x => { x.v = "s"; show("8", typeof inner.v); });
  const table = { early() {}, undefined() { resolve(inner); } }; table[seen](); await done; }
// 9: the last index of a regular expression that is hidden late
{ const re = /x/g; function move(t) { t.lastIndex = { valueOf() { return 0; } }; } move(hide(/y/)); const table = { early() { return /z/; }, undefined() { return hide(re); } }; move(table[seen]()); show("9", typeof re.lastIndex); }
