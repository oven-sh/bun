const notes = [];
function* lowest(limit) { let made = 0; try { for (let i = 1; i <= limit; i++) { made += i; yield i; } } finally { notes.push("lowest made " + made); } }
function* middle(limit) { let passed = 0; try { for (const value of lowest(limit)) { passed += value; if (value % 2) yield value * 10; else yield value * 100; } } finally { notes.push("middle passed " + passed); } }
function consume(limit, stopAt) { let sum = 0; let turns = 0; for (const value of middle(limit)) { sum += value; if (++turns === stopAt) break; } return sum + " in " + turns; }
console.log(consume(4, 9), consume(4, 3), consume(0, 1));
console.log(notes.join("; "));
