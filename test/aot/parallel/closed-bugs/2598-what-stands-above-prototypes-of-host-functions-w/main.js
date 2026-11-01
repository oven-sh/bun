// Flags: --aot-validate
function f() { return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.sql)) }; }
console.log(typeof f().above, f().above === Function.prototype);
function g() { return { above: Object.getPrototypeOf(Bun.sql) }; }
console.log(typeof g().above);
function h() { return { above: Object.getPrototypeOf(Object.getPrototypeOf(Bun.$)) , first: Object.getPrototypeOf(Bun.$) }; }
console.log(typeof h().above, typeof h().first);
