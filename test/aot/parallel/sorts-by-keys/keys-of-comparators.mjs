// A comparator that subtracts one expression of its two values sorts by that expression, computed once for each value. Nothing may tell.
let calls = 0;
const trace = [];
function rank(card) {
  let found = card.codePointAt(0) & 0xf;
  if (found == 1) found = 15;
  return found;
}
const area = o => o.w * o.h;
const half = o => o.w / 2;
function counted(o) { calls++; return o.w; }
function throwing(o) { if (o.w === 5) throw new RangeError("five " + o.id); return o.w; }
const order = { low: 1, mid: 2, high: 3 };
class Item {
  constructor(id, w, h) { this.id = id; this.w = w; this.h = h; }
  get seen() { trace.push(this.id); return this.w; }
  size() { return this.w - this.h; }
}
class Deck {
  static rankOf(card) { return card.codePointAt(0) & 7; }
  constructor(cards) { this.cards = cards; }
  score() {
    this.cards.sort((a, b) => rank(b) - rank(a));
    return this.cards.join(" ");
  }
  scoreByClass() {
    this.cards.sort((a, b) => Deck.rankOf(a) - Deck.rankOf(b));
    return this.cards.join(" ");
  }
}
class Player extends Deck {
  turn() { return this.score(); }
}
const card = (suit, value) => String.fromCodePoint(0x1f0a0 + 16 * suit + value);
const cards = n => Array.from({ length: n }, (_, i) => card((i * 7) % 4, 1 + ((i * 11) % 14)));
const items = (n, of) => Array.from({ length: n }, (_, i) => of(i));
const show = list => list.map(v => (v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? v.join(":") : v.id)).join(",");
function report(name, sort) {
  try {
    console.log(name, sort());
  } catch (error) {
    console.log(name, error.constructor.name, error.message);
  }
}

for (const n of [0, 1, 2, 5, 13, 31, 32, 33, 64, 65, 200]) {
  const player = new Player(cards(n));
  report(`player ${n}`, () => player.turn());
  report(`class ${n}`, () => new Deck(cards(n)).scoreByClass());
  report(`area ${n}`, () => show(items(n, i => new Item(i, (i * 37) % 11, i % 5)).sort((a, b) => area(a) - area(b))));
  report(`field ${n}`, () => show(items(n, i => new Item(i, (i * 37) % 11, i % 5)).sort((a, b) => b.w - a.w)));
  report(`both ${n}`, () => show(items(n, i => new Item(i, (i * 37) % 11, i % 5)).sort((a, b) => a.w - b.h)));
  report(`same ${n}`, () => show(items(n, i => new Item(i, (i * 37) % 11, i % 5)).sort((a, b) => a.w - a.w)));
  report(`half ${n}`, () => show(items(n, i => new Item(i, ((i * 37) % 11) - 5, 0)).sort((a, b) => half(a) - half(b))));
  report(`size ${n}`, () => show(items(n, i => new Item(i, (i * 13) % 17, i % 7)).sort((a, b) => a.size() - b.size())));
  report(`level ${n}`, () => show(items(n, i => ({ id: i, level: ["mid", "low", "high", "gone"][(i * 3) % 4] })).sort((a, b) => order[a.level] - order[b.level])));
  report(`length ${n}`, () => show(items(n, i => "x".repeat((i * 7) % 5) + i).sort((a, b) => a.length - b.length)));
  report(`pair ${n}`, () => show(items(n, i => [(i * 5) % 9, i]).sort((a, b) => b[0] - a[0])));
}
for (const odd of [NaN, -0, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, 5e-324, "7", null, undefined, true]) {
  for (const n of [5, 40]) {
    const make = () => items(n, i => new Item(i, i % 4 === 2 ? odd : (i * 37) % 9, i % 3));
    report(`odd ${String(odd)} ${n}`, () => show(make().sort((a, b) => a.w - b.w)));
    report(`odd half ${String(odd)} ${n}`, () => show(make().sort((a, b) => half(b) - half(a))));
  }
}
report("big", () => show(items(6, i => new Item(i, BigInt((i * 5) % 4), 1n)).sort((a, b) => area(a) - area(b))));
report("counted", () => (calls = 0, [show(items(6, i => new Item(i, (i * 5) % 4, 1)).sort((a, b) => counted(a) - counted(b))), calls].join(" ")));
report("getter", () => [show(items(5, i => new Item(i, (i * 5) % 4, 1)).sort((a, b) => a.seen - b.seen)), trace.join("")].join(" "));
report("throws", () => {
  const list = items(7, i => new Item(i, (i * 3) % 7, 1));
  try {
    return show(list.sort((a, b) => throwing(a) - throwing(b)));
  } catch (error) {
    return `${error.message} ${show(list)}`;
  }
});
report("undefined", () => show([card(0, 5), undefined, card(1, 3), undefined, card(2, 9)].sort((a, b) => rank(a) - rank(b))));
report("holes", () => { const list = [card(0, 5), , card(1, 3), , card(2, 9)].sort((a, b) => rank(b) - rank(a)); return `${show(list)} ${Object.keys(list)}`; });
report("other", () => show([card(0, 5), 3, card(1, 3)].sort((a, b) => rank(a) - rank(b))));
report("frozen", () => show(Object.freeze(cards(5)).sort((a, b) => rank(a) - rank(b))));
report("sealed", () => show(Object.seal(cards(5)).sort((a, b) => rank(a) - rank(b))));
report("pushed", () => { const list = cards(5); list.push(card(3, 2)); list.shift(); return show(list.sort((a, b) => rank(a) - rank(b))); });
report("held", () => { const list = cards(6); const same = list.sort((a, b) => rank(a) - rank(b)); return [same === list, list.length, show(list)].join(" "); });
report("itself", () => { const list = cards(6); return show(list.sort((a, b) => list.indexOf(a) - list.indexOf(b))); });
class Cards extends Array {}
report("subclass", () => { const list = Cards.from(cards(6)); return [list.sort((a, b) => rank(a) - rank(b)) instanceof Cards, show(list)].join(" "); });
for (let turn = 0; turn < 3; turn++) {
  const list = cards(9);
  list.sort((a, b) => rank(b) - rank(a));
  console.log(turn, list.join(" "));
}
// In loops: every length around those at which the way of sorting changes, with equal keys.
function cardsOfRound(n, round) { const list = []; for (let i = 0; i < n; i++) list.push(card((i * 7 + round) % 4, 1 + ((i * 11 + round) % 14))); return list; }
function itemsOfRound(n, round) { const list = []; for (let i = 0; i < n; i++) list.push(new Item(i, ((i * 37 + round * 5) % 11) - 4, (i + round) % 3)); return list; }
for (let n = 0; n <= 44; n++) {
  const hand = cardsOfRound(n, n);
  hand.sort((a, b) => rank(b) - rank(a));
  const low = cardsOfRound(n, 3);
  low.sort((a, b) => rank(a) - rank(b));
  const byWidth = itemsOfRound(n, n);
  byWidth.sort((a, b) => a.w - b.w);
  const byTie = itemsOfRound(n, 1);
  byTie.sort((a, b) => b.h - a.h);
  const byHalf = itemsOfRound(n, 2);
  byHalf.sort((a, b) => a.w / 2 - b.w / 2);
  const bySize = itemsOfRound(n, 4);
  bySize.sort((a, b) => b.size() * 1000000007 - a.size() * 1000000007);
  console.log("round", n, hand.join(""), low.join(""), show(byWidth), show(byTie), show(byHalf), show(bySize));
}
function mixedKeys(list) { const out = []; for (let round = 0; round < 3; round++) { const sorted = list.slice(); sorted.sort((a, b) => a.w - b.w); out.push(show(sorted)); } return out.join(" / "); }
const withWidths = widths => { const list = []; for (let i = 0; i < widths.length; i++) list.push(new Item(i, widths[i], 1)); return list; };
console.log(mixedKeys(withWidths([3, 1, 2, 1])), mixedKeys(withWidths([0, -0, 0, -0, 1])), mixedKeys(withWidths([1.5, 1, 2.5, 1])), mixedKeys(withWidths([2 ** 31, 1, -(2 ** 31), 0])), mixedKeys(withWidths([NaN, 1, 0])), mixedKeys(withWidths([Infinity, 1, -Infinity, Infinity])));
function differentKeys(list) { const out = []; for (let round = 0; round < 3; round++) { const sorted = list.slice(); sorted.sort((a, b) => a.w - b.h); out.push(show(sorted)); sorted.sort((a, b) => area(a) - half(b)); out.push(show(sorted)); } return out.join(" / "); }
console.log(differentKeys(itemsOfRound(6, 2)), differentKeys(itemsOfRound(3, 1)));
function seenKeys(list) { const out = []; for (let round = 0; round < 2; round++) { trace.length = 0; const sorted = list.slice(); sorted.sort((a, b) => a.seen - b.seen); out.push(show(sorted), trace.join("")); calls = 0; sorted.sort((a, b) => counted(b) - counted(a)); out.push(show(sorted), calls); } return out.join(" / "); }
console.log(seenKeys(itemsOfRound(5, 2)), seenKeys(itemsOfRound(2, 1)));
