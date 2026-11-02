// A hundred thousand objects of the class that the function makes.
class P { n = 1; k() { return this.n; } }
class Q { n = 2; k() { return this.n; } }
class B extends (Date.now() > 0 ? P : Q) {}
const derive = (c) => class extends c {};
const Made = derive(B);
let sum = 0;
for (let i = 0; i < 100000; i++) sum += new Made().k();
console.log(sum);
