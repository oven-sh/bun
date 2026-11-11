'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let total = 0;
const score = [1, , 3];
bell.add((first, second, third) => { total = (total * 2 + first + (second === undefined ? 50 : second) + third) | 0; });
for (let i = 0; i < 7; i++) bell.ring(score);
console.log(total);
