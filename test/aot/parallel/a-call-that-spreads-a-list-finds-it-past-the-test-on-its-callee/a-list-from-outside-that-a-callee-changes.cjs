'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer(...notes); }
}
const bell = new Bell();
const score = [1, 2];
let total = 0;
bell.add((first, second) => { total = (total + first * 10 + (second === undefined ? 7 : second)) | 0; score.pop(); });
bell.add((first, second) => { total = (total * 3 + (first === undefined ? 5 : first) + (second === undefined ? 7 : second)) | 0; score.unshift(total & 15, 4); });
const n = 7;
for (let i = 0; i < n; i++) bell.ring(score);
console.log(total, score.length, score.join());
