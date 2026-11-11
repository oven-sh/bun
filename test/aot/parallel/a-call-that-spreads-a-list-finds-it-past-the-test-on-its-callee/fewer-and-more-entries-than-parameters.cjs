'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(...notes) { for (const ringer of this.ringers) ringer(...notes); }
}
const bell = new Bell();
let total = 0;
bell.add((first, second, third) => { total = (total * 2 + (first === undefined ? 1 : first) + (second === undefined ? 10 : second) + (third === undefined ? 100 : third)) % 100003; });
const n = 7;
for (let i = 0; i < n; i++) { bell.ring(); bell.ring(i); bell.ring(i, i + 1); bell.ring(i, i + 1, i + 2); bell.ring(i, i + 1, i + 2, i + 3, i + 4); }
console.log(total);
