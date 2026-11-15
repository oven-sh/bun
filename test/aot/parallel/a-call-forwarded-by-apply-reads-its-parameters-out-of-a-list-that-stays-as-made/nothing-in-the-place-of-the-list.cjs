'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(notes) { for (const ringer of this.ringers) ringer.apply(this, notes); }
}
const bell = new Bell();
let total = 0;
bell.add((first, second) => { total = (total * 2 + (first === undefined ? 9 : first) + (second === undefined ? 50 : second)) % 100003; });
for (let i = 0; i < 7; i++) { bell.ring(undefined); bell.ring(null); bell.ring([i, 5]); }
console.log(total);
