// the close of a loop calls `return` of the program's own iterator without an argument, and another call hands it a number
class Countdown {
  constructor(from) { this.left = from; }
  [Symbol.iterator]() { return this; }
  next() { if (this.left <= 0) return { done: true, value: undefined }; this.left -= 1; return { done: false, value: this.left }; }
  return(reason) { const words = []; words.push(typeof reason); words.push(reason === undefined ? "nothing" : "something"); words.push(String(reason)); console.log(words.join(" ")); this.left = 0; return { done: true, value: reason }; }
}
function leaveEarly(from) { let seen = 0; for (const left of new Countdown(from)) { seen += left; if (left < 2) break; } return seen; }
function closeByHand(from) { const countdown = new Countdown(from); countdown.next(); return countdown.return(7).value; }
console.log(String(closeByHand(3)));
console.log(String(leaveEarly(4)));
console.log(String(closeByHand(5)));
console.log(String(leaveEarly(3)));
