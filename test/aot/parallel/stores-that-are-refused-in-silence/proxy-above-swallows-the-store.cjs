const above = new Proxy({}, { set() { return true; } });
const E = Object.create(above);
E.a = 1;
console.log(E.a, Object.keys(E).length);
