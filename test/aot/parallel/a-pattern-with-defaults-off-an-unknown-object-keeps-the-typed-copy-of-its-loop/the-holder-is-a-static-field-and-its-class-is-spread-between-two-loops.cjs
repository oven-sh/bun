"use strict";
class Settings { static choices = JSON.parse("{\"width\":3,\"inset\":2}"); }
function walk(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum += Settings.choices.width * turn; return sum; }
let total = walk(10);
total += Object.keys({ ...Settings }).length;
total += walk(1000);
console.log(total);
