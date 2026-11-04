let made = 0;
function Base() { made++; this.a = made; }
class Below extends Base { constructor(twice) { super(); if (twice) super(); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { try { out.push(new Below(i === 1).a); } catch (e) { out.push(e.constructor.name); } } return out.join(" ") + " " + made; }
console.log(run(3));
