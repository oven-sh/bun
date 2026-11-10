const source = JSON.parse(JSON.stringify("Привет Мир ".repeat(40)));
let sum = 0;
for (let turn = 0; turn < 60; turn++) { const lower = source.toLowerCase(), upper = source.toUpperCase(); sum += lower.charCodeAt(turn) + upper.charCodeAt(turn); if (turn % 7 === 0) Bun.gc(true); const fresh = (source + turn).toLowerCase(); sum += fresh.length; }
console.log(sum);
