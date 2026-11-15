// A direct eval sees that a WeakSet of one function is a WeakSet.
function asked(x) { const seen = new WeakSet(); seen.add(x); return eval("seen.has(x) + typeof seen.forEach + (seen instanceof Set)"); }
function named(x) { const seen = new WeakSet(); seen.add(x); return (() => eval("seen.constructor.name"))(); }
function given(x, source) { const seen = new WeakSet(); seen.add(x); const has = seen.has(x); return has + eval(source); }
const object = {};
console.log(asked(object), named(object));
console.log(given(object, "`${seen instanceof WeakSet} ${seen.delete(x)} ${seen.size}`"), given(object, "String(seen)"));
