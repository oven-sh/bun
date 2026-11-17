function Base(v) { this.held = v; }
function never() { return false; }
function spoil(o) { o.x = "text"; return true; }
Object.defineProperty(Base, Symbol.hasInstance, { value: never, writable: true });
class O { constructor(n) { this.x = n; } }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function sum(o) { return o.x + 1; }
function ask(o) { return o instanceof A; }
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2)
        Base[Symbol.hasInstance] = spoil;
    const o = new O(JSON.parse("1"));
    said += ask(o) + " " + sum(o) + " ";
}
console.log(said);
