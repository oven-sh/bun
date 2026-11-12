"use strict";
const weights = JSON.parse("[" + Array.from({ length: 300 }, (_, i) => i + 0.5).join() + "]"), word = JSON.parse('"fill"');
function scale() { let load = 0; return { fill(list) { load = 0; for (let i = 0; i < list.length; i++) load = load + list[i]; return load; }, spoil(x) { load = x; } }; }
const pan = scale();
let sum = 0; for (let t = 0; t < 7; t++) sum = (sum + pan[word](weights) + t % 2) % 1000003;
console.log(Math.floor(sum), pan[word]([1, , 3]), pan[word]([1, "2", 3]), pan[word]([]));
