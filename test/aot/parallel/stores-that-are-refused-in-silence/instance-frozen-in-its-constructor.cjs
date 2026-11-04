class P { constructor() { this.x = 1; Object.freeze(this); } }
function move(p) { p.x = 2; p.y = 3; return p; }
const p = move(new P());
console.log(p.x, p.y);
