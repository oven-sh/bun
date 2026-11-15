// Function.prototype is reached from the global object by steps that are parsed at the run, and the names are parsed too: the build sees neither the object nor a name at the stores.
// No compiled code took those names for absent, so all three roads lay them; and whoever then reads a function under a key that is computed, or asks whether the name is there, finds them as plain Bun does.
const steps = JSON.parse('["Function","prototype"]');
const names = JSON.parse('["addedOne","addedTwo","addedThree"]');
const holder = steps.reduce((from, step) => from[step], globalThis);
function plain() { return 1; }
const arrow = () => 2;
class Made { method() { return 3; } static fixed() { return 4; } }
const bound = plain.bind(null);
const functions = { plain, arrow, Made, bound, method: Made.prototype.method, fixed: Made.fixed, parse: JSON.parse };
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const seen = fn => names.map(k => [fn[k], k in fn, Object.hasOwn(fn, k), Reflect.has(fn, k), Reflect.get(fn, k)].join(",")).join(" ");
function summed(fn) { let sum = 0; for (let turn = 0; turn < 3000; turn++) sum += fn[names[turn % 3]] | 0; return sum; }
const all = word => { for (const name of Object.keys(functions)) console.log(word, name, seen(functions[name]), summed(functions[name])); };
all("before");
console.log("assign", attempt(() => { "use strict"; holder[names[0]] = 1; return holder[names[0]]; }));
console.log("define", attempt(() => { Object.defineProperty(holder, names[1], { value: 2, configurable: true, writable: true }); return holder[names[1]]; }));
console.log("set", attempt(() => Reflect.set(holder, names[2], 3) + " " + holder[names[2]]));
all("behind");
console.log("delete", attempt(() => delete holder[names[1]]), seen(plain), summed(arrow));
