const show = (label, made) => console.log(label, Object.keys(made).join(), JSON.stringify(made), "added" in made, Object.entries(made).length);
const literal = () => ({ count: 1, label: "two" });

function spreadThenAssign() { const made = literal(); const again = [...new Set([made])][0]; Object.assign(again, { added: 2 }); show("spread, Object.assign", made); }
function written() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; Object.assign(again, { added: 2 }); show("written here, Object.assign", made); }
function store() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; again.added = 2; show("a store", made); }
function storeOverField() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; again.count = 7; show("a store over a field", made); return made.count; }
function define() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; Object.defineProperty(again, "added", { value: 2, enumerable: true }); show("defineProperty", made); }
function remove() { const made = { count: 1, label: "two" }; const again = [...new Set([made])][0]; delete again.label; show("delete", made); }
function from() { const made = { count: 1, label: "two" }; const again = Array.from(new Set([made]))[0]; Object.assign(again, { added: 2 }); show("Array.from", made); }
function fromThenStore() { const made = { count: 1, label: "two" }; const again = Array.from(new Set([made]))[0]; again.added = 2; show("Array.from, a store", made); }
function added() { const made = { count: 1, label: "two" }; const set = new Set(); set.add(made); const again = [...set][0]; again.added = 2; show("a set filled by add", made); }
function second() { const first = { count: 0, label: "one" }; const made = { count: 1, label: "two" }; const list = [...new Set([first, made, first])]; list[1].added = 2; show("the second member", made); show("the first member", first); return list.length; }
function loop() { const made = { count: 1, label: "two" }; for (const each of [...new Set([made])]) each.added = 2; show("a loop over the list", made); }
function callback() { const made = { count: 1, label: "two" }; [...new Set([made])].forEach(each => { each.added = 2; }); show("forEach", made); }
function pattern() { const made = { count: 1, label: "two" }; const [again] = [...new Set([made])]; again.added = 2; show("a pattern", made); }
function popped() { const made = { count: 1, label: "two" }; const again = [...new Set([made])].pop(); again.added = 2; show("pop", made); }
function frozen() { const made = { count: 1, label: "two" }; Object.freeze([...new Set([made])][0]); let failed = false; try { (() => { "use strict"; made.added = 2; })(); } catch { failed = true; } show("freeze", made); return failed; }
function prototype() { const made = { count: 1, label: "two" }; Object.setPrototypeOf([...new Set([made])][0], { inherited: 3 }); show("setPrototypeOf", made); return made.inherited; }
function same() { const made = { count: 1, label: "two" }; return [...new Set([made])][0] === made && Array.from(new Set([made]))[0] === made; }
function lists() { const made = [1, 2]; const again = [...new Set([made])][0]; again.push(3); again.extra = true; return made.length + " " + Object.keys(made).join(); }
function handedOut() { const made = { count: 1, label: "two" }; return [[...new Set([made])], made]; }
function throughArray() { const made = { count: 1, label: "two" }; const again = [...[made]][0]; again.added = 2; show("a spread list", made); }
function throughMap() { const made = { count: 1, label: "two" }; const again = [...new Map([["k", made]]).values()][0]; again.added = 2; show("the values of a map", made); }

for (const each of [spreadThenAssign, written, store, storeOverField, define, remove, from, fromThenStore, added, second, loop, callback, pattern, popped, frozen, prototype, same, lists, throughArray, throughMap]) {
  const answer = each();
  if (answer !== undefined) console.log(each.name, answer);
}
const [list, made] = handedOut();
list[0].added = 2;
show("handed out", made);
let kept = 0;
for (let i = 0; i < 20000; i++) {
  const fresh = { count: i, label: "n" + i };
  const again = [...new Set([fresh])][0];
  again.added = i;
  kept += Object.keys(fresh).length + fresh.added;
}
console.log("many", kept);
