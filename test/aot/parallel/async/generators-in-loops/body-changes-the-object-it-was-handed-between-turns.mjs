// the caller makes an object, hands it to a generator function and reads it in each turn of the loop, and the body stores into it behind each yield
function* counts(box) { for (let i = 0; i < 3; i++) { box.n = box.n + 10; yield i; } box.n = -1; }
function deed() { const box = { n: 1 }; let text = ""; for (const value of counts(box)) { text += value + ":" + box.n + ";"; box.n++; } return text + box.n; }
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
