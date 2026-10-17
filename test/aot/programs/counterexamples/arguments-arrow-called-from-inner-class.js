// An arrow function keeps the `arguments` of the function that made it when a method with its own `arguments` calls it.
function g() { const f = () => arguments[0]; return new class { k() { arguments; return f(); } }().k(2); }
console.log(g(1));
