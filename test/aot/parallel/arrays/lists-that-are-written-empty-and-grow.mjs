// An empty list is born with the room and the kind of storage that its site has seen its lists come to.
function collect(n, make) { const found = []; for (let i = 0; i < n; i++) found.push(make(i)); return found; }
function describe(list) { return [list.length, JSON.stringify(list.slice(0, 4)), list.at(-1)].join(":"); }
const makers = [i => i, i => i + 0.5, i => "s" + i, i => ({ i }), i => (i % 2 ? i : "t"), i => (i % 3 ? i : 0.25), i => undefined, i => NaN, i => -0];
for (let round = 0; round < 40; round++) {
  const out = [];
  for (const make of makers) for (const n of [0, 1, 2, 7, 40, round]) out.push(describe(collect(n, make)));
  if (round % 13 === 0) console.log(out.join(" "));
}
function holes() { const list = []; list[3] = 1; return [list.length, 0 in list, Object.keys(list).join()].join(":"); }
function named() { const list = []; list.name = "n"; list.push(1); return JSON.stringify(list) + list.name; }
function frozen() { const list = Object.freeze([]); try { list.push(1); } catch (error) { return error.name; } return "no"; }
function long() { const list = []; list.length = 5; list.push(1); return list.length + ":" + (4 in list); }
function two() { const a = [], b = []; a.push(1); b.push("x"); return a.concat(b).join(); }
for (let round = 0; round < 30; round++) { const line = [holes(), named(), frozen(), long(), two()].join(" "); if (round % 10 === 0) console.log(line); }
