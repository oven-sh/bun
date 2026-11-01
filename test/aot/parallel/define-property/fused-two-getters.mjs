function reader(x) { return Reflect.get(x, "extra"); }
try { reader(new Proxy({}, {})); } catch {}
Object.defineProperties(Array.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; }, get other() { return 1; } }));
const x = [1, 2];
let seen;
try { seen = reader(x); } catch (error) { seen = "THREW " + String(error.message).slice(0, 48); }
console.log("" + seen);
