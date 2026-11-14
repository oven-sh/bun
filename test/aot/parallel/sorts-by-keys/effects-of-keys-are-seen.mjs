// What a key does is done at each comparison: nothing of it may be done once for each element.
const trace = [], other = [], seen = new Set(), table = new Map(), box = { n: 0 }, marks = {};
let calls = 0, text = "";
class Item {
  constructor(id, x) { this.id = id; this.x = x; this.marks = 0; }
  get read() { trace.push(this.id); return this.x; }
  pushed() { trace.push(this.id); return this.x; }
}
const effects = {
  pushes(o) { trace.push(o.id); return o.x; },
  pushesTwo(o) { trace.push(o.id, o.x); return o.x; },
  pops(o) { if (trace.length > 2) trace.pop(); trace.push(o.x); return o.x; },
  unshifts(o) { trace.unshift(o.id); return o.x; },
  shifts(o) { trace.push(o.id); if (trace.length > 5) trace.shift(); return o.x; },
  stores(o) { trace[trace.length] = o.id; return o.x; },
  shortens(o) { trace.push(o.id); if (trace.length > 7) trace.length = 1; return o.x; },
  counts(o) { calls++; return o.x; },
  boxes(o) { box.n++; return o.x; },
  adds(o) { seen.add(o.id * 100 + seen.size); return o.x; },
  sets(o) { table.set(o.id, (table.get(o.id) ?? 0) + 1); return o.x; },
  marksElement(o) { o.marks++; return o.x; },
  marksUnderKey(o) { marks["m" + o.id] = (marks["m" + o.id] ?? 0) + 1; return o.x; },
  appendsText(o) { text += o.id; return o.x; },
  changesKey(o) { const x = o.x; if (o.id === 2) o.x = (o.x + 1) % 5; return x; },
};
const build = round => { const list = []; for (let i = 0; i < 5 + (round & 3); i++) list.push(new Item(i, (i * 37 + round) % 11)); return list; };
const show = list => list.map(o => o.id + ":" + o.x + ":" + o.marks).join(" ");
const rest = () => { const line = [trace.join(), other.join(), [...seen].join(), [...table].join(";"), box.n, calls, text, JSON.stringify(marks)].join("|"); if (trace.length > 9) trace.length = 0; text = ""; return line; };
const { pushes, pushesTwo, pops, unshifts, shifts, stores, shortens, counts, boxes, adds, sets, marksElement, marksUnderKey, appendsText, changesKey } = effects;
function byFunctions() {
  for (let round = 0; round < 4; round++) {
    const list = build(round);
    list.sort((a, b) => pushes(a) - pushes(b)); console.log("pushes", show(list), rest());
    list.sort((a, b) => pushesTwo(b) - pushesTwo(a)); console.log("pushesTwo", show(list), rest());
    list.sort((a, b) => pops(a) - pops(b)); console.log("pops", show(list), rest());
    list.sort((a, b) => unshifts(b) - unshifts(a)); console.log("unshifts", show(list), rest());
    list.sort((a, b) => shifts(a) - shifts(b)); console.log("shifts", show(list), rest());
    list.sort((a, b) => stores(b) - stores(a)); console.log("stores", show(list), rest());
    list.sort((a, b) => shortens(a) - shortens(b)); console.log("shortens", show(list), rest());
    list.sort((a, b) => counts(b) - counts(a)); console.log("counts", show(list), rest());
    list.sort((a, b) => boxes(a) - boxes(b)); console.log("boxes", show(list), rest());
    list.sort((a, b) => adds(b) - adds(a)); console.log("adds", show(list), rest());
    list.sort((a, b) => sets(a) - sets(b)); console.log("sets", show(list), rest());
    list.sort((a, b) => marksElement(b) - marksElement(a)); console.log("marksElement", show(list), rest());
    list.sort((a, b) => marksUnderKey(a) - marksUnderKey(b)); console.log("marksUnderKey", show(list), rest());
    list.sort((a, b) => appendsText(b) - appendsText(a)); console.log("appendsText", show(list), rest());
    list.sort((a, b) => changesKey(a) - changesKey(b)); console.log("changesKey", show(list), rest());
  }
}
function byMembers() {
  for (let round = 0; round < 4; round++) {
    const list = build(round);
    list.sort((a, b) => a.read - b.read); console.log("read", show(list), rest());
    list.sort((a, b) => b.pushed() - a.pushed()); console.log("pushed", show(list), rest());
    list.sort((a, b) => { const p = pushes(a), q = pushes(b); return p - q; }); console.log("parts", show(list), rest());
    list.sort((a, b) => other.push(a.id) * 0 + a.x - (other.push(b.id) * 0 + b.x)); console.log("inline", show(list), rest());
    if (other.length > 20) other.length = 0;
  }
}
class Holder { constructor() { this.list = build(1); } sort() { this.list.sort((a, b) => pushes(a) - pushes(b)); return this.list; } }
const holder = new Holder();
byFunctions(); byMembers(); byFunctions();
for (let i = 0; i < 4; i++) console.log("holder", show(holder.sort()), rest());
// The comparator does something beside the two keys.
let last = 0, first = 0;
function storesKeys(a, b) { return (last = a.x) - (last = b.x); }
function storesBefore(a, b) { last += a.id; return a.x - b.x; }
function storesBehind(a, b) { const difference = a.x - b.x; first++; return difference; }
function callsBeside(a, b) { trace.push(a.id); return a.x - b.x; }
function marksBeside(a, b) { a.marks++; return a.x - b.x; }
function throwsBeside(a, b) { a.read; return a.x - b.x; }
function besides() {
  for (let round = 0; round < 4; round++) {
    const list = build(round);
    list.sort(storesKeys); console.log("storesKeys", show(list), last);
    list.sort(storesBefore); console.log("storesBefore", show(list), last);
    list.sort(storesBehind); console.log("storesBehind", show(list), first);
    list.sort(callsBeside); console.log("callsBeside", show(list), rest());
    list.sort(marksBeside); console.log("marksBeside", show(list));
    list.sort(throwsBeside); console.log("throwsBeside", show(list), rest());
    list.sort((a, b) => (first = a.id, a.x) - (first = b.id, b.x)); console.log("commas", show(list), first);
    list.sort((a, b) => { last = b.x; return a.x - b.x; }); console.log("inline", show(list), last);
  }
}
besides(); besides();
