class O { constructor(n) { this.x = n; } }
class Top { static make(o) { o.x = "text"; return 1; } }
function Base() {}
Object.setPrototypeOf(Base.prototype, Top.prototype);
class A extends Base {}
function sum(o) { return o.x + 1; }
function ask(o) {
    try {
        return A.make(o);
    } catch (error) {
        return error.constructor.name;
    }
}
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2)
        Object.setPrototypeOf(Base, Top);
    const o = new O(JSON.parse("1"));
    said += ask(o) + " " + sum(o) + " ";
}
console.log(said);
