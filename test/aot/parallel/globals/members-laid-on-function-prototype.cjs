// A method that a helper lays on Function.prototype under a computed name is found on functions of the engine, and a read that comes first takes nothing from the program.
function lay(target, name, value) { return Object.defineProperty(target, name, { value, writable: true, configurable: true }); }
function layAll(owner, methods) { const target = globalThis[owner].prototype; for (const name in methods) lay(target, name, methods[name]); }
console.log(typeof Math.max.part, typeof Reflect.other, typeof JSON.parse.part);
layAll("Function", { part() { return this.name; } });
console.log(Math.max.part(), Reflect.ownKeys.part(), Array.part(), Array.isArray.part(), typeof Promise.all.other, Reflect.other);
const held = parseInt, key = process.argv.length > 60 ? "x" : "more";
globalThis["Func" + "tion"].prototype[key] = function () { return this.length; };
console.log(held.more(), Math.min.more(), Object.keys.more(), delete Function.prototype.part, Math.max.part);
