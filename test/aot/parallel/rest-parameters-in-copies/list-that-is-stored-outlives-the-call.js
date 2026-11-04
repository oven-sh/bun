const kept = [];
function keep(...xs) { kept.push(xs); return xs.length; }
let sum = 0;
for (let i = 0; i < 5; i++) sum += keep(i, "a", i * 2);
for (const one of kept) one.reverse();
console.log(sum, JSON.stringify(kept));
