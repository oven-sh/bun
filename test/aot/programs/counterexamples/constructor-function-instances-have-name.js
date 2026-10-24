// Objects made by a constructor function are told from plain objects by strict deep equality and by `Bun.inspect`.
function Foo() {}
const o = Reflect.construct(Foo, []);
console.log(Bun.deepEquals(o, {}, true), Bun.inspect(o), o.constructor.name);
