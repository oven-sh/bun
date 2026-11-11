'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let total = 0;
class Score extends Array { get length() { return 1; } }
const score = new Score(); score.push(4, 5);
bell.add((first, second) => { total = (total * 2 + (first === undefined ? 9 : first) + (second === undefined ? 50 : second)) | 0; });
for (let i = 0; i < 7; i++) { bell.ring(score); bell.ring([i, 2]); }
console.log(total);
