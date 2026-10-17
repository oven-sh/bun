// `then` of an instance of a subclass of Promise yields an instance of the subclass.
class S extends Promise {}
const p = S.resolve(1);
console.log(p.then() instanceof S, p["then"]() instanceof S);
