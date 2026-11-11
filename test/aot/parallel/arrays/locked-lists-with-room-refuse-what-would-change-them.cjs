// A list that has grown and shrunk again HAS ROOM behind its last element. Then it is frozen, sealed, closed, or its length is made read-only.
// A frozen list keeps the plain kind of its storage and is only MARKED as not to be written: whoever pops or splices in place by the kind alone would change it silently. (A push is turned away twice: freezing gives the list storage without room.)
// Every call goes through a place that nobody proves anything of, so the stubs are asked. What plain Bun throws must be thrown, and the list must stand as it stood.
"use strict";
const hide = v => [v][JSON.parse("0")], box = { toString() { return "box"; } };
const kinds = { ints: () => [1, 2, 3], doubles: () => [1.5, 2.5, 3.5], values: () => ["a", box, 3], texts: () => ["x", "y", "z"] };
function withRoom(a) { for (let i = 0; i < 9; i++) a.push(a[0]); for (let i = 0; i < 9; i++) a.pop(); return a; }
const locks = {
  free: a => a, frozen: a => Object.freeze(a), sealed: a => Object.seal(a), closed: a => Object.preventExtensions(a),
  lengthReadOnly: a => Object.defineProperty(a, "length", { writable: false }), lastReadOnly: a => Object.defineProperty(a, 2, { writable: false }),
};
function pushOne(a, v) { return a.push(v); }
function pushTwo(a, v) { return a.push(v, v); }
function pushThree(a, v) { return a.push(v, v, v); }
function popOne(a) { return a.pop(); }
function takeOne(a) { return a.splice(1, 1).join(); }
function putOne(a, v) { return a.splice(1, 1, v).join(); }
function seek(a, v) { return a.indexOf(v) + "" + a.includes(v); }
const deeds = { pushOne, pushTwo, pushThree, popOne, takeOne, putOne, seek };
for (const kind in kinds) for (const lock in locks) {
  let line = kind + " " + lock + ":";
  for (const deed in deeds) {
    const a = locks[lock](withRoom(kinds[kind]())); let said;
    for (let round = 0; round < 2; round++) { try { said = String(deeds[deed](hide(a), hide(a[0]))); } catch (e) { said = e.name; } }
    line += " " + deed + "=" + said + "/" + a.length + "[" + a.join() + "]";
  }
  console.log(line);
}
