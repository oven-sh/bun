// import.meta has no property of its own. Its members lie on an object that nothing hands out: a read by name finds them and what Object.prototype has, and no walk does.
const m = import.meta;
const k = s => s.split("").join("");
for (const name of ["url", "dir", "dirname", "env", "file", "filename", "main", "path", "require", "resolve", "resolveSync", "hot", "toString", "hasOwnProperty", "constructor", "__proto__", "nothing", "glob"]) {
  console.log(name, typeof m[k(name)], k(name) in m, Object.hasOwn(m, k(name)), Reflect.has(m, k(name)));
}
console.log(typeof m[Symbol.toStringTag], m[Symbol.toStringTag], Object.prototype.toString.call(m), Symbol.toStringTag in m);
console.log(Object.getPrototypeOf(m), Reflect.getPrototypeOf(m), m instanceof Object, Object.isExtensible(m));
console.log(Reflect.ownKeys(m), Object.keys(m), JSON.stringify(m), Object.getOwnPropertyDescriptor(m, "url"));
for (const key in m) console.log("in loop", key);
console.log({ ...m });
m.added = 1; console.log(m.added, Reflect.ownKeys(m), import.meta.added, m === import.meta);
console.log(m);
try { m.url = "x"; console.log("stored", m.url === "x"); } catch (e) { console.log(e.name, e.message); }
m[Symbol.for("nodejs.util.inspect.custom")] = () => "mine";
console.log(m);
try { console.log(String(m)); } catch (e) { console.log(e.name, e.message); }
try { console.log(Reflect.setPrototypeOf(m, {}), Object.getPrototypeOf(m)); } catch (e) { console.log(e.name, e.message); }
