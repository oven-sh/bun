'use strict';
class Bell {
  constructor() { this.ringers = []; }
  add(ringer) { this.ringers.push(ringer); }
  ring(...notes) { for (const ringer of this.ringers) ringer(...notes); }
}
const bell = new Bell();
let total = 0;
bell.add((note, times) => { total = (total + note.pitch * times) | 0; });
const n = 7;
for (let i = 0; i < n; i++) bell.ring({ pitch: i }, 2);
bell.ringers.length = 3;
let said = '';
try { bell.ring({ pitch: 9 }, 3); } catch (error) { said = error.constructor.name + ': ' + error.message; }
console.log(total, said);
