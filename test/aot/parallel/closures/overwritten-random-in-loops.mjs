// A function written over Math.random is copied into loops; what it stores is undone where a turn goes back to the loop as written.
let calls = 0, last = 0;
(() => {
  let seed = 49734321;
  Math.random = () => {
    calls++;
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    last = seed >>> 0;
    return last / 0x1_0000_0000;
  };
  Math.random.restart = value => { seed = value; };
  Math.random.peek = () => seed;
})();
class Deck {
  constructor(list) { this.fill(list); }
  fill(list) { this.cards = list.slice(); }
  shuffle() {
    for (let index = this.cards.length; index !== 0;) {
      const at = Math.floor(Math.random() * index);
      index--;
      const held = this.cards[index];
      this.cards[index] = this.cards[at];
      this.cards[at] = held;
    }
  }
  take(n, scale) {
    let text = "";
    for (let k = 0; k < n; k++) text += this.cards[Math.floor(Math.random() * scale)];
    return text;
  }
  add(n, scale) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.cards[Math.trunc(Math.random() * scale)];
    return sum;
  }
}
class Letters {
  constructor(list) { this.fill(list); }
  fill(list) { this.held = list.slice(); }
  shuffle() {
    for (let index = 12; index !== 0;) {
      const at = Math.floor(Math.random() * index);
      index--;
      const held = this.held[index];
      this.held[index] = this.held[at];
      this.held[at] = held;
    }
  }
}
const short = new Letters([..."ABCDEFGHIJKLMNOP"]);
const letters = new Deck([..."abcdefghijklm"]), numbers = new Deck([1, 2.5, 3, 4, 5, 6, 7, 8]), mixed = new Deck([1, "two", 3, null, undefined, 6]);
for (let turn = 0; turn < 5; turn++) {
  for (const deck of [letters, numbers, mixed]) deck.shuffle();
  short.shuffle();
  console.log(short.held.join(""));
  console.log(letters.cards.join(""), numbers.cards.join(), mixed.cards.map(String).join());
  console.log(letters.take(9, 13), letters.take(9, 15), letters.take(5, -3), numbers.add(9, 8), numbers.add(9, 9.5), mixed.take(9, 6), mixed.add(7, 6));
  console.log(calls, last, Math.random.peek());
  if (turn === 2) { Math.random.restart(7.5); letters.cards.length = 11; delete letters.cards[3]; short.held.length = 9; short.held[4] = 7; }
}
