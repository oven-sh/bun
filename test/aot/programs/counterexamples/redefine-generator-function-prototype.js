// `Reflect.defineProperty(g, "prototype", { value: g.prototype })` answers true.
function make() { function* inner() {} inner(); return inner; }
const g = make();
console.log(Reflect.defineProperty(g, "prototype", { value: g.prototype }));
