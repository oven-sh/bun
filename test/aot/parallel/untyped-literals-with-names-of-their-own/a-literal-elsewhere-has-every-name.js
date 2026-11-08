const whole = { first: 1, second: 2 };
function read(value) { return String(value.first) + String(value.second); }
function make(flag) { return flag ? { first: 3 } : { second: 4 }; }
let text = "";
for (let turn = 0; turn < 300; turn++) text = read(make(turn % 2 === 0)) + read(whole);
console.log(text);
