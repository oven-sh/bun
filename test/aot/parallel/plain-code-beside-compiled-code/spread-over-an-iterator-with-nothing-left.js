const said = [], first = JSON.parse('"x"'), second = JSON.parse('"y"'), late = JSON.parse('"a"');
function spread(it) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return [...it].length; }
function count(...all) { return all.length; }
function call(it) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return count(...it); }
function from(it) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return Array.from(it).length; }
const intoMap = m => m.set(late, 1), intoSet = s => s.add(late);
const cases = {
  "keys stepped to the end": [() => { const h = new Map([[first, 0]]); const it = h.keys(); it.next(); return [h, it]; }, intoMap],
  "values stepped to the end": [() => { const h = new Map([[first, 0]]); const it = h.values(); it.next(); return [h, it]; }, intoMap],
  "set stepped to the end": [() => { const h = new Set([first]); const it = h.values(); it.next(); return [h, it]; }, intoSet],
  "stepped, the rest deleted": [() => { const h = new Map([[first, 0], [second, 1]]); const it = h.keys(); it.next(); h.delete(second); return [h, it]; }, intoMap],
  "stepped, then cleared": [() => { const h = new Set([first, second]); const it = h.values(); it.next(); h.clear(); return [h, it]; }, intoSet],
  "never stepped, empty": [() => { const h = new Map(); return [h, h.keys()]; }, intoMap],
  "never stepped, one left": [() => { const h = new Set([first]); return [h, h.values()]; }, intoSet],
};
for (let turn = 0; turn < 3; turn++) for (const [how, take] of [["literal", spread], ["call", call], ["from", from]]) for (const [name, [make, add]] of Object.entries(cases)) {
  const [holder, it] = make(), n = take(it); add(holder); const step = it.next();
  if (turn === 2) said.push(how + " " + name + ":" + n + ":" + (step.done ? "done" : String(step.value)));
}
console.log("SAID " + said.join(" | "));
/* Output:
SAID literal keys stepped to the end:0:done | literal values stepped to the end:0:done | literal set stepped to the end:0:done | literal stepped, the rest deleted:0:done | literal stepped, then cleared:0:done | literal never stepped, empty:0:done | literal never stepped, one left:1:done | call keys stepped to the end:0:done | call values stepped to the end:0:done | call set stepped to the end:0:done | call stepped, the rest deleted:0:done | call stepped, then cleared:0:done | call never stepped, empty:0:done | call never stepped, one left:1:done | from keys stepped to the end:0:a | from values stepped to the end:0:1 | from set stepped to the end:0:a | from stepped, the rest deleted:0:a | from stepped, then cleared:0:a | from never stepped, empty:0:a | from never stepped, one left:1:done
*/
