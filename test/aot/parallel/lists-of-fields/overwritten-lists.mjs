// STATISTIC: ListsOfFieldsReleased >= 4
// A list that only its field names is released where a store overwrites the field: the next list is made in its cell.
const CARDS = Array.from({ length: 52 }, (_, i) => "c" + i);
class Deck {
  constructor() { this.fresh(); }
  fresh() { this.cards = CARDS.slice(0); }
  shuffle(by) { this.fresh(); for (let i = 52; i !== 0;) { const at = (i * by) % i; i--; const held = this.cards[i]; this.cards[i] = this.cards[at]; this.cards[at] = held; } }
  deal() { return this.cards.shift(); }
}
class Hand {
  constructor() { this.clear(); }
  clear() { this.held = []; this.rank = 0; }
  take(card) { this.held.push(card); }
  score() { this.held.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))); const text = this.held.join(); for (const card of this.held) this.rank = (this.rank * 31 + card.length) | 0; return text + this.rank; }
}
class Heir extends Hand { constructor(name) { super(); this.name = name; } best() { return this.held[0] + this.name + this.held.length; } }
class Tokens {
  list = [];
  read(text) { this.list = []; let word = ""; for (const c of text) { if (c === " ") { if (word) this.list.push(word); word = ""; } else word += c; } if (word) this.list.push(word); return this.count(); }
  count() { let n = 0; this.list.forEach(word => { n += word.length; }); return n * this.list.length; }
}
// Each of these names the list elsewhere, or uses it while a store comes.
class Kept { constructor() { this.seen = []; } next(i) { this.seen = [i]; all.push(this.seen); return this.seen.length; } }
class Used { constructor() { this.parts = [1, 2, 3]; } reset() { this.parts = []; this.parts.push(9); } walk() { let sum = 0; for (const part of this.parts) { sum += part; if (part === 2) this.reset(); } return sum; } }
class Asked { constructor() { this.rows = []; } clear(i) { this.rows = []; return i; } add(i) { this.rows.push(this.clear(i)); return this.rows.length; } keep(i) { const rows = this.rows; this.clear(i); rows.push(i, i); return rows.length * 10 + this.rows.length; } }
class Shared { constructor() { this.both = []; } }
class Later { constructor() { this.queue = []; } async run(i) { const queue = this.queue; await 0; return queue.length + i; } set(i) { this.queue = []; for (let k = 0; k < i; k++) this.queue.push(k); } *steps() { for (const v of this.queue) yield v; } }
const all = [], lines = [];
const deck = new Deck(), hands = [new Heir("a"), new Heir("b"), new Hand(), new Heir("c")], tokens = new Tokens(), kept = new Kept(), used = new Used(), asked = new Asked(), one = new Shared(), two = new Shared(), later = new Later(), waits = [];
let junk;
for (let round = 0; round < 300; round++) {
  deck.shuffle(7 + round);
  for (const hand of hands) hand.clear();
  for (let i = 0; i < 5; i++) for (const hand of hands) hand.take(deck.deal());
  let line = ""; for (const hand of hands) line += hand.score() + (hand instanceof Heir ? hand.best() : "");
  line += deck.cards.length + tokens.read("one two  three " + round) + kept.next(round);
  used.parts = [1, 2, 3, 4]; line += used.walk() + ":" + used.parts.length + asked.add(round) + asked.keep(round);
  const list = []; one.both = list; two.both = list; one.both.push(round); line += two.both.length;
  later.set(round % 5); if (round % 50 === 0) waits.push(later.run(round)); for (const v of later.steps()) { line += v; if (v === 2) later.set(1); }
  if (round % 60 === 0) for (let i = 0; i < 20000; i++) junk = [i, junk && i];
  lines.push(line);
}
let hash = 0; for (const line of lines) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(lines.length, hash, lines[0], lines.at(-1), all.length, all.slice(-3).join(), all.every((row, i) => row[0] === i));
Promise.all(waits).then(all => console.log(all.join()));
