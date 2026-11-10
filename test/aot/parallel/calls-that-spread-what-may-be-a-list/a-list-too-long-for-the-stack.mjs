function two(a, b) { return a + b; }
function run(list, n) { let said = "none"; for (let i = 0; i < n; i++) { try { said = String(two(...list)); } catch (e) { said = e.constructor.name; } } return said; }
const long = new Array(JSON.parse("70000")).fill(1), short = long.slice(0, 100);
console.log(`SAID ${run(short, 2)} ${run(long, 2)}`);
