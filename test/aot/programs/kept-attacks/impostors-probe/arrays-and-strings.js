// Impostors probe: arrays and strings. It prints what plain Bun prints.
const list = [];
for (let i = 0; i < 100; i++) list.push(i * 2);
console.log(list.filter(n => n % 3 === 0).map(n => n + 1).reduce((a, b) => a + b, 0), list.slice(-2).join(), [3, 1, 2].sort().join());
console.log("abc".charCodeAt(1), "a,b".split(",").length, `x${1 + 1}y`.toUpperCase(), "abc".replace("b", m => m + m));
