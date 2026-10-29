// A literal spreads an object that holds a number under the name of the method that follows, and the method is deleted before anybody reads it.
const A = { a: 2 };
const r = (() => ({ ...A, a() {} }))();
delete r.a;
console.log(r.a);
