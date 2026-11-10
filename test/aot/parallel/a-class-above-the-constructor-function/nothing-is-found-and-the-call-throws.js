class O { constructor(n) { this.x = n; } }
class Top { static make(o) { o.x = "text"; return 1; } }
function Base() {}
Object.setPrototypeOf(Base.prototype, Top.prototype);
class A extends Base {}
function sum(o) { return o.x + 1; }
const o = new O(JSON.parse("1"));
let said;
try {
    said = A.make(o);
} catch (error) {
    said = error.constructor.name;
}
console.log(said, sum(o), typeof o.x);
