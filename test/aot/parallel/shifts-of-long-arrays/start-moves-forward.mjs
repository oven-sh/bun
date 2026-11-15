// The first element of a long array goes: the start of its storage moves, and everything else about the array stays.
const makers = {
  strings: i => "s" + i, objects: i => ({ id: i }), integers: i => i, fractions: i => i + 0.5, mixed: i => (i % 3 ? i : "m" + i),
};
const show = v => (typeof v === "object" && v ? v.id : v);
function deal(list, count) {
  let text = "";
  for (let i = 0; i < count; i++) text += show(list.shift()) + " ";
  return text;
}
function queue(list, turns, make) {
  let last;
  for (let i = 0; i < turns; i++) {
    last = list.shift();
    list.push(make(1000 + i));
  }
  return show(last);
}
function readBeside(list, turns) {
  let text = "";
  for (let i = 0; i < turns; i++) {
    const before = list[0], after = list[list.length - 1];
    const gone = list.shift();
    text += `${show(before)}${before === gone ? "=" : "!"}${show(list[0])}/${show(after)}/${list.length} `;
  }
  return text;
}
function storeBeside(list, turns, make) {
  for (let i = 0; i < turns; i++) {
    list.shift();
    list[3] = make(500 + i);
    list[list.length - 1] = make(700 + i);
  }
}
function unshiftBeside(list, turns, make) {
  for (let i = 0; i < turns; i++) {
    const gone = list.shift();
    list.unshift(make(300 + i));
    list.shift();
    list.unshift(gone);
    list.shift();
  }
}
const ends = list => [list.length, show(list[0]), show(list[list.length - 1]), show(list[5]), Object.keys(list).length, list.slice(0, 4).map(show).join(), list.concat(["c"]).length, list.map(show).filter((_, i) => i % 9 === 0).join(), [...list].length, JSON.stringify(list).length, list.indexOf(list[7])].join(" | ");
for (const [name, make] of Object.entries(makers)) {
  for (const n of [31, 32, 33, 34, 52, 100, 127, 128, 129, 130, 300]) {
    const of = () => Array.from({ length: n }, (_, i) => make(i));
    const sliced = of().slice(0), grown = [];
    for (let i = 0; i < n; i++) grown.push(make(i));
    for (const list of [sliced, grown]) {
      console.log(name, n, deal(list, 20), ends(list));
      console.log(queue(list, 70, make), ends(list));
      console.log(readBeside(list, 5), ends(list));
      storeBeside(list, 4, make);
      console.log(ends(list));
      unshiftBeside(list, 3, make);
      list.splice(2, 3, make(1), make(2));
      list.reverse();
      list.length -= 1;
      list.extra = name;
      console.log(ends(list), list.extra, deal(list, 3), list.extra, ends(list));
      list.sort();
      list.fill(make(9), 2, 4);
      list.copyWithin(1, 5, 8);
      console.log(ends(list), deal(list, 4), ends(list));
    }
  }
}
const withHole = Array.from({ length: 60 }, (_, i) => "h" + i);
delete withHole[4];
delete withHole[0];
console.log(deal(withHole, 9), withHole.length, Object.keys(withHole).length);
const frozen = Object.freeze(Array.from({ length: 60 }, (_, i) => "f" + i));
try { deal(frozen, 2); } catch (error) { console.log(error.constructor.name, frozen.length); }
class Queue extends Array {}
const queued = Queue.from({ length: 60 }, (_, i) => "q" + i);
console.log(deal(queued, 25), queued.length, queued instanceof Queue, queued.slice(0, 3).join());
const kept = [];
for (let round = 0; round < 200; round++) {
  const list = Array.from({ length: 52 }, (_, i) => ({ id: round * 100 + i, padding: "p".repeat(i % 7) }));
  deal(list, 20);
  if (round % 10 === 0) kept.push(list);
}
if (globalThis.Bun) Bun.gc(true);
console.log(kept.map(list => `${list.length}:${list[0].id}:${list[31].id}:${list.reduce((sum, o) => sum + o.padding.length, 0)}`).join(" "));
