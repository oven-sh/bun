// Functions that store variables of their file are copied into loops of the file's body.
export let steps = 0;
var label;
let latest = null;
const mixed = JSON.parse('[1,2,"x",4]'), held = JSON.parse("[0.5,2.5]");
const count = +process.argv[2] || 6;
function step(i) { for (let k = 0; k < 3; k++) { steps = steps + 1; held[k & 1] = held[k & 1] + i; } return held[0]; }
function name(i) { for (let k = 0; k < 3; k++) { label = "n" + k; mixed[k] = mixed[k] + i; } return label; }
function keep(i) { for (let k = 0; k < 3; k++) { latest = { i, k }; mixed[k] = mixed[k] + 1; } return latest.k; }
let sum = 0;
for (let i = 0; i < count; i++) { sum += step(i); held[0] = i; }
for (let i = 0; i < count; i++) { sum += name(i).length; held[1] = i; }
for (let i = 0; i < count; i++) { sum += keep(i); latest = { i, k: sum }; held[1] = held[1] + 0.5; }
console.log(sum, steps, label, latest.i, latest.k, mixed.join(), held.join());
