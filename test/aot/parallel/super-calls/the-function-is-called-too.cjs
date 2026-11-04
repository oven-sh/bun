function Base(a) { this.a = a; }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const plain = { z: 0 }; Base.call(plain, i); out.push(Object.keys(plain).join("") + Object.keys(new Below(i)).join("") + Object.keys(new Base(i)).join("")); } return out.join(" "); }
console.log(run(3));
