// A whole number out of a list of doubles may stay in the box of a double when a switch or an equality has shown that it is an int32. Sums ask both boxes.
const parsed = JSON.parse("[0.5,1,2,3,4,-0,2147483647,-2147483648]");
parsed.push("text");
function bySwitch(value) { switch (value) { case 3: return { a: value, b: [value] }; } return { a: 0, b: [0] }; }
function byEquality(value) { if (value === 3) return { a: value, b: [value] }; return { a: 0, b: [0] }; }
function byCases(value) { switch (value) { case 4: return { a: value, b: [value] }; case 3: return { a: value, b: [value] }; } return { a: 100, b: [1000] }; }
function bare(value) { switch (value) { case 3: return [value]; } return [0]; }
for (let r = 0; r < 3; r++) { const p = bySwitch(parsed[3]); console.log(p.b[0], p.a + p.b[0]); }
for (let r = 0; r < 3; r++) { const p = bySwitch(parsed[3]); console.log(p.a, p.b[0], p.a + p.b[0], p.b[0] + p.a, p.a - p.b[0], p.b[0] - p.a); }
for (let r = 0; r < 3; r++) { const p = byEquality(parsed[3]); console.log(p.b[0], p.a + p.b[0], p.b[0] + 1, 1 + p.b[0], p.b[0] - 1); }
for (let r = 0; r < 3; r++) { const p = byCases(parsed[3 + (r & 1)]); console.log(p.a, p.b[0], p.a + p.b[0]); }
for (let r = 0; r < 3; r++) { const p = bare(parsed[3]); console.log(p[0] + p[0], p[0] + 1, p[0] - r, r + p[0]); }
let told = "";
for (let r = 0; r < 3; r++) { const p = bySwitch(parsed[3]); told += p.a + "," + p.b[0] + "," + (p.a + p.b[0]) + ";"; }
console.log(told);
function run(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const p = bySwitch(list[i]); sum += p.a + p.b[0]; } return sum; }
console.log(run(parsed), run([3, 3, "t"]), run([0.5, 3]));
const thirds = Array.from(new Float64Array([0.5, 1, 2, 3]));
thirds.push(null);
for (let r = 0; r < 3; r++) { const p = bySwitch(thirds[3]); console.log(p.b[0], p.a + p.b[0]); }
const halves = [1, 2, 4, 6].map(x => x / 2);
halves.push(undefined);
for (let r = 0; r < 3; r++) { const p = bySwitch(halves[3]); console.log(p.b[0], p.a + p.b[0]); }
