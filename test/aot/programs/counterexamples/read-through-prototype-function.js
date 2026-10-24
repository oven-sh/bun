// A read that is repeated often through a function used as a prototype sees a property that the function gets later.
function P() {}
const c = Object.create(P), seen = [];
for (let i = 0; i < 16; i++) { if (i === 8) Object.assign(P, { x: 1 }); seen.push(c.x); }
console.log(seen.join(), Object.getPrototypeOf(c) === P, Object.keys(P).join());
