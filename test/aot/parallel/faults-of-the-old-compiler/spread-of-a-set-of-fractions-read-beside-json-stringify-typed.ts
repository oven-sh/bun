// A list made by spreading a Set of fractions is written as JSON and read by index in one function: typed.
const ids: number[] = [2.5, 6.5, 2.5];
function report(l: number[]) { const u: number[] = [...new Set(l)]; const t = JSON.stringify(u); return (t === "[2.5,6.5]") + ":" + (u[1] === 6.5); }
console.log(report(ids), report(ids));
export {};
