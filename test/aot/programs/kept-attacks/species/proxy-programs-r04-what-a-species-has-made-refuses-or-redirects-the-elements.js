// Species: proxy programs  what a species has made refuses or redirects the elements. It prints what plain Bun prints.
const log = [];
const attempt = (name, species, run) => { const source = [1, 2]; source.constructor = { [Symbol.species]: species }; try { const made = run(source); log.push(name + " " + typeof made + " " + JSON.stringify(Object.getOwnPropertyDescriptor(made, "0") ?? null)); } catch (error) { log.push(name + " " + error.constructor.name); } };
attempt("frozen", function () { return Object.freeze({ tag: 1 }); }, s => s.slice());
attempt("accessor", function () { const o = { tag: 2 }; Object.defineProperty(o, "0", { get() { return "got"; }, configurable: true }); return o; }, s => s.map(x => x * 2));
attempt("fixed", function () { const o = {}; Object.defineProperty(o, "0", { get() { return "got"; }, configurable: false }); return o; }, s => s.filter(() => true));
attempt("proxy", function () { return new Proxy({}, { defineProperty(target, key, descriptor) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); }, set(target, key, value) { log.push("set " + String(key) + "=" + value); target[key] = value; return true; } }); }, s => s.concat(3));
attempt("inherited", function () { return Object.create({ set 0(v) { log.push("never"); } }); }, s => s.flat());
console.log(log.join("; "));
