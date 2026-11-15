'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let said = '';
const score = [1, 2, 3, 4, 5, 6, 7, 8];
const strike = (first, second, third) => { said += first + ',' + second + ',' + third + ';'; score.shift(); };
bell.add(strike); bell.add(strike); bell.add(strike);
const rounds = 2;
for (let i = 0; i < rounds; i++) bell.ring(score);
console.log('SAID', said, score.length);
