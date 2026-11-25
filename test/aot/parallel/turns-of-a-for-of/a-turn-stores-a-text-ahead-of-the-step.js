// A turn stores a text where the call has written an integer, and a later step hands it out: what goes round the loop of the caller is no integer, whatever the call lists.
function join(...values) { let s = 0; for (const value of values) { values[2] = "x"; s += value; } return s; }
function pushed(...values) { let s = 0; for (const value of values) { if (values.length < 4) values.push("y"); s += value; } return s; }
function run(n) { let out = 0; for (let i = 0; i < n; i++) out = out + join(i & 1, 1, 2) + pushed(i & 1, 1, 2); return out; }
const made = run(20);
console.log(typeof made, made.length, made.slice(0, 12), join(1, 2, 3), pushed(1, 2, 3));
