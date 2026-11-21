// A hole reads what the prototype holds: the loop that skips what differs from a string does not skip it. A string that is no atom equals the atom of its text.
// STATISTIC: SearchLoops >= 3
const log = [];
const hide = v => JSON.parse("0", () => v);
const plain = ["a", , "b", , "c", "d", "e"];
const inherits = Object.setPrototypeOf(["a", , "b", , "c", "d", "e"], Object.create(Array.prototype, { 1: { value: "inherited" }, 3: { get() { log.push("got"); return "got"; } } }));
class List extends Array { get 1() { return "of the class"; } }
const derived = List.from({ length: 6, 0: "a", 2: "b", 3: "c", 4: "d", 5: "e" }); delete derived[2];
let list = plain;
function exists(list, x) { for (var i = 0; i < list.length; i++) { if (list[i] === x) return true; } return false; }
function place(list, x) { let at = -1; for (let i = 0, n = list.length; i < n; i++) { if (list[i] === x) { at = i; break; } } return at; }
function count(list, x) { let found = 0; for (let i = 0; i < list.length; i++) if (x === list[i]) found++; return found; }
for (const lists of [[plain], [plain, inherits], [inherits, derived, plain]])
    for (const of of lists) for (const x of ["a", "inherited", "got", "of the class", "e", "none", hide(undefined)])
        log.push([exists(of, hide(x)), place(of, hide(x)), count(of, hide(x))].join());
const names = ["width", "height", "length", "name", "value", "margin", "padding"];
const sizes = {}; for (const name of names) sizes[name] = name.length;
for (const parts of [["len", "gth"], ["val", "ue"], ["pad", "ding"], ["wi", "dth"], ["no", "ne"]]) {
    const x = hide(parts.join(""));
    log.push([exists(names, x), place(names, x), count(names, x), exists(Object.keys(sizes), x), count([x, ...names, x], "length")].join());
}
console.log(log.join("\n"));
