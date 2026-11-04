function later(...xs) { return () => xs.join("+"); }
function counter(...xs) { return () => xs.push(0); }
const made = [];
for (let i = 0; i < 4; i++) made.push(later(i, i * i));
const count = counter(1, 2);
console.log(made.map(one => one()).join(), count(), count(), counter()());
