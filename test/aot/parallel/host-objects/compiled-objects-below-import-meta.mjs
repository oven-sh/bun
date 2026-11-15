// A search that comes through a compiled object goes on behind it as behind a plain one: through import.meta to what stands above it, though whoever asks import.meta what stands above it is told null.
class K { own = 1; }
function F() { this.own = 1; }
const holder = (globalThis.holder = {});
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
holder.literal = { own: 1, __proto__: import.meta };
holder.ofClass = Object.setPrototypeOf(new K(), import.meta);
holder.ofFunction = Object.setPrototypeOf(new F(), import.meta);
holder.relinkedLiteral = Object.setPrototypeOf({ own: 2 }, import.meta);
holder.throughPlain = { own: 1, __proto__: Object.create(import.meta) };
holder.plainBelowCompiled = Object.create({ own: 1, __proto__: import.meta });
holder.twoCompiled = { own: 1, __proto__: { other: 2, __proto__: import.meta } };
holder.withExtra = { own: 1, __proto__: import.meta }; holder.withExtra[(holder.key = "extra")] = 3;
// An array answers for its own properties itself, in plain code too: behind it import.meta is asked, and says null.
holder.belowArray = { own: 1, __proto__: Object.setPrototypeOf([1], import.meta) };
holder.arrayBelowCompiled = Object.setPrototypeOf([1], { own: 1, __proto__: import.meta });
holder.belowFunction = { own: 1, __proto__: Object.setPrototypeOf(function () {}, import.meta) };
holder.belowProxy = { own: 1, __proto__: new Proxy(Object.create(import.meta), {}) };
holder.meta = import.meta;
const names = ["toString", "hasOwnProperty", "url", "env", "dir", "main", "require", "resolve", "own", "nothing", "__proto__", "constructor", Symbol.toStringTag, 0];
for (const which of Object.keys(holder)) {
  const o = holder[which];
  if (typeof o !== "object") continue;
  for (let turn = 0; turn < 2; turn++) {
    const out = [];
    for (const name of names) out.push(String(name) + ":" + [attempt(() => typeof o[name]), attempt(() => name in o), attempt(() => typeof Reflect.get(o, name)), attempt(() => Reflect.has(o, name)), attempt(() => Object.hasOwn(o, name))].join());
    const listed = []; for (const key in o) listed.push(key);
    console.log(which, out.join(" "), "|", typeof o.toString, typeof o.url, typeof o.env, "toString" in o, "url" in o, attempt(() => String(o)), listed.join(), o instanceof Object, Object.prototype.isPrototypeOf(o), attempt(() => JSON.stringify(o)));
  }
}
// Stores: a name that stands above import.meta.
for (const which of ["literal", "ofClass", "throughPlain", "plainBelowCompiled", "twoCompiled"]) {
  const o = holder[which];
  console.log(which, attempt(() => { o.url = 5; return o.url; }), Object.hasOwn(o, "url"), attempt(() => { o.toString = 6; return o.toString; }), Object.hasOwn(o, "toString"), attempt(() => { "use strict"; o.main = 7; return o.main; }), Object.hasOwn(o, "main"), attempt(() => Reflect.set(o, "dir", 8)), o.dir, attempt(() => delete o.url), typeof o.url, "url" in o);
}
