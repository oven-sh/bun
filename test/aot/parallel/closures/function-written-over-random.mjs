// Math.random written over by one closure with a property, called in loops, by value and behind a name; its value is put back at the end.
const was = Math.random;
(() => {
  let seed = 49734321;
  Math.random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return (seed >>> 0) / 4294967296;
  };
  Math.random.reset = () => { seed = 49734321; };
})();
class Deck {
  cards = Array.from({ length: 12 }, (_, k) => "c" + k);
  shuffle() {
    for (let index = this.cards.length; index !== 0;) {
      const other = Math.floor(Math.random() * index);
      index--;
      const held = this.cards[index];
      this.cards[index] = this.cards[other];
      this.cards[other] = held;
    }
    return this.cards.join();
  }
}
const deck = new Deck();
for (let round = 0; round < 3; round++) console.log(deck.shuffle());
Math.random.reset();
const f = Math.random;
console.log(f(), [1, 2].map(Math.random).join(), Math.random.call(null), Math?.random?.());
function sum(n) { let s = 0; for (let k = 0; k < n; k++) { if (k === 5) Math.random = was; s += Math.random() < 2 ? 1 : 0; } return s; }
console.log(sum(9), Math.random === was);
