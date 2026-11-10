'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(...notes) { this.held = notes; for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let said = '';
const strike = function (first, second, third) { said += first + ',' + second + ',' + third + ';'; this.held.shift(); };
bell.add(strike); bell.add(strike); bell.add(strike);
const rounds = 2;
for (let i = 0; i < rounds; i++) bell.ring(i + 1, i + 2, i + 3);
console.log('SAID', said, bell.held.length);
