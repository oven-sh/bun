const copy = {};
for (const key of Reflect.ownKeys(URL.prototype)) { const d = Object.getOwnPropertyDescriptor(URL.prototype, key); if ("value" in d) copy[key] = d.value; }
try { console.log(copy); } catch (error) { console.log(error.name, error.message); }
console.log("after");
