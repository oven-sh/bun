// `h.f = g` in the test of a loop calls the setter of the object that h names in that iteration.
let h = { set f(x) { console.log("a", typeof x); } }, g = 0;
const b = { set f(x) { console.log("b", typeof x); } };
while ((h.f = g, h !== b)) { const k = h; h = b; g = () => k; }
