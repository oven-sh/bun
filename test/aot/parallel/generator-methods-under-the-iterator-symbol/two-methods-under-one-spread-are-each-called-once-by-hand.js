// Two methods that one spread calls, each with a class of its own and each called once by hand: neither runs at most once.
class Countdown {
  constructor(from) { this.left = from; this.opened = 0; }
  [Symbol.iterator]() { class Mark { constructor(count) { this.count = count; } } this.opened = new Mark(this.opened + 1).count; return this; }
  next() { class Step { constructor(value, done) { this.value = value; this.done = done; } } const seen = this.left; this.left = seen - 1; return new Step(seen, seen <= 0); }
}
const countdown = new Countdown(3);
const same = countdown[Symbol.iterator]() === countdown;
const first = countdown.next();
const rest = [...countdown];
console.log(same, first.value, rest.join(), countdown.left, countdown.opened);
