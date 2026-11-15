'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let total = 0;
const score = [1, 2];
bell.add((first, second) => { total = (total + first * 10 + (second === undefined ? 7 : second)) | 0; score.pop(); });
bell.add((first, second) => { total = (total * 3 + (first === undefined ? 5 : first) + (second === undefined ? 7 : second)) | 0; score.unshift(total & 15, 4); });
for (let i = 0; i < 7; i++) bell.ring(score);
console.log(total);
