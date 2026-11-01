// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(URLSearchParams.prototype));
try { console.log(copy); } catch (error) { console.log(error.name, error.message); }
console.log("after");
