'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(...notes) { for (const ringer of this.ringers) ringer(...notes); }
}
const bell = new Bell();
let total = 0;
bell.add((note, times) => { total = (total + note.pitch * times) | 0; if (bell.ringers.length < 4) bell.add((other, count) => { total = (total - other.pitch + count) | 0; }); });
const n = 7;
for (let i = 0; i < n; i++) bell.ring({ pitch: i + 3 }, 2);
console.log(total, bell.ringers.length);
