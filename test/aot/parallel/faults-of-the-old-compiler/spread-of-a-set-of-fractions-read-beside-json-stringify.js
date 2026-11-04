// A list made by spreading a Set of fractions is written as JSON and read by index in one function.
const ids = [2.5, 6.5, 2.5];
function report(l) { const u = [...new Set(l)]; const t = JSON.stringify(u); return (t === "[2.5,6.5]") + ":" + (u[1] === 6.5); }
console.log(report(ids), report(ids));
