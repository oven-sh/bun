class Base { ["si" + "ze"] = JSON.parse('"own"'); }
class H1 extends Base {} class H2 extends Base {} class H3 extends Base {}
class H4 extends Base { get size() { return "getter"; } }
function made(n) { return n === 0 ? new Base() : n === 1 ? new H1() : n === 2 ? new H2() : new H3(); }
for (let n = 0; n < 4; ++n) console.log(made(n).size);
console.log(new H4().size, Object.hasOwn(new H4(), "size"));
