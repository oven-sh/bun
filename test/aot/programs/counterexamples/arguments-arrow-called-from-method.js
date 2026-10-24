// An arrow function keeps the `arguments` of the function that made it when a method without `arguments` calls it.
function g() { const f = () => arguments[0]; class C { k() { return f(); } } return new C().k(); }
console.log(g(1));
