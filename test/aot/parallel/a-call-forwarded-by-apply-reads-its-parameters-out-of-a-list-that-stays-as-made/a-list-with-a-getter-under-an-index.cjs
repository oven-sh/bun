'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let total = 0;
const score = [1, 2];
let asked = 0;
Object.defineProperty(score, 1, { get() { asked++; return asked * 100; }, configurable: true, enumerable: true });
bell.add((first, second) => { total = (total + first + second) | 0; });
for (let i = 0; i < 7; i++) bell.ring(score);
total = total * 10 + asked;
console.log(total);
