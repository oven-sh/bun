// Only api.run() calls the method by name, and api is stored behind `later`: but a conversion enters it earlier.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let api;
class T { run() { return later.x; } toString() { return "" + this.run(); } }
const t = new T();
console.log(attempt(() => `${t}`));
const later = { x: 1 };
api = t;
console.log(api.run());
