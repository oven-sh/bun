// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const copy = {};
for (const key of Reflect.ownKeys(URL.prototype)) { const d = Object.getOwnPropertyDescriptor(URL.prototype, key); if ("value" in d) copy[key] = d.value; }
try { console.log(copy); } catch (error) { console.log(error.name, error.message); }
console.log("after");
