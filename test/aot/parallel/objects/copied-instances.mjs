// What is copied from one instance to another stays what it was when the first gets other values.
class Hand {
  constructor() { this.clear(); }
  clear() { this.held = []; this.rank = 0; }
  take(card) { this.held.push(card); }
  score() { let sum = 0; for (const card of this.held) sum = (sum * 31 + card) | 0; return sum + this.held.length; }
}
class Heir extends Hand {
  constructor(name) { super(); this.name = name; }
  text() { return this.name + this.held.join(""); }
}
const hands = [new Hand(), new Hand(), new Hand()], heirs = [new Heir("a"), new Heir("b")];
const lines = [];
for (let round = 0; round < 30; round++) {
  for (const hand of hands) hand.clear();
  for (const heir of heirs) heir.clear();
  for (let i = 0; i < 12; i++) { for (const hand of hands) hand.take(i + round); for (const heir of heirs) heir.take(i); }
  Object.assign(hands[1], hands[0]);
  hands[0].clear();
  for (let i = 0; i < 12; i++) hands[0].take(99);
  let line = ""; for (const hand of hands) line += hand.score() + " ";
  Object.assign(heirs[1], heirs[0]);
  heirs[0].clear();
  for (let i = 0; i < 4; i++) heirs[0].take(7);
  for (const heir of heirs) line += heir.text() + " " + heir.score() + " ";
  lines.push(line);
}
console.log(lines[0]);
console.log(lines[1]);
console.log(lines[29], lines.length);
