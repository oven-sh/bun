let count = 41.5;
var total = 7;
let ticks = 0;
function read() { return count + 1; }
function sum() { return (total + 1) | 0; }
function tick() { ticks = (ticks + 1) | 0; return ticks; }
for (let i = 0; i < 3; i++) console.log(read(), sum(), tick());
try { console.log("in"); JSON.parse("{"); } catch (error) { console.log(error.name, read(), sum()); }
if (process.argv.length > 5) console.log("many"); else console.log("few");
setTimeout(() => console.log("later", read(), sum(), tick()), 0);
count += 1;
total = (total + 1) | 0;
console.log(read(), sum(), tick());
