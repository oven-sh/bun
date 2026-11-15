function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
function test(x) { return x instanceof A; }
let said = "";
for (let i = 0; i < 6; i++) {
    if (i === 3)
        Object.defineProperty(Base, Symbol.hasInstance, { value: function (object) { object.held = "changed"; return true; } });
    const b = new Base(i);
    said += test(b) + ":" + b.held + ";";
}
console.log(said);
