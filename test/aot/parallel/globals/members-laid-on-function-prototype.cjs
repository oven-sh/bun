// A method that a helper lays on Function.prototype under a computed name is found on functions of the engine, and a read that comes first takes nothing from the program.
function hide(object, key, value) { return Object.defineProperty(object, key, { configurable: true, writable: true, value }); }
function $export(name, source) { for (const key in source) hide(globalThis[name].prototype, key, source[key]); }
console.log(typeof Math.max.part, typeof Reflect.other, typeof JSON.parse.part);
$export("Function", { part() { return this.name; } });
console.log(Math.max.part(), Reflect.ownKeys.part(), Array.part(), Array.isArray.part(), typeof Promise.all.other, Reflect.other);
const held = parseInt, key = process.argv.length > 60 ? "x" : "more";
globalThis["Func" + "tion"].prototype[key] = function () { return this.length; };
console.log(held.more(), Math.min.more(), Object.keys.more(), delete Function.prototype.part, Math.max.part);
