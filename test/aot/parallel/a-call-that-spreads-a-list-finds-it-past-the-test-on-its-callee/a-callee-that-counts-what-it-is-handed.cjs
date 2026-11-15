'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(...notes) { for (const ringer of this.ringers) ringer(...notes); }
}
const bell = new Bell();
let total = 0;
bell.add(function (first) { total = (total * 5 + arguments.length + (first === undefined ? 3 : first)) % 100003; });
const n = 7;
for (let i = 0; i < n; i++) { bell.ring(); bell.ring(i); bell.ring(i, 1, 2, 3); }
console.log(total);
