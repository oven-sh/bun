// `Object.create(parent)` makes a compiled object. Whatever the parent is, a lookup from the object goes where it goes from a plain one. ONE KIND OF PARENT: frozen, sealed and closed parents.
const holder = (globalThis.holder = {});
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const kind = (v) => (v === null ? "null" : typeof v);
// Each way of asking for what is inherited, under each name. The maker stores one name in its own body, so that the object has a layout and a field.
function ask(parent, names) {
  const below = Object.create(parent);
  let stored = "stored";
  try { below.own = 1; } catch (e) { stored = e.constructor.name; }
  const out = [stored];
  for (const name of names) {
    out.push(String(name) + ":" + [attempt(() => kind(below[name])), attempt(() => name in below), attempt(() => Object.hasOwn(below, name)), attempt(() => kind(Reflect.get(below, name))), attempt(() => Reflect.has(below, name))].join(""));
  }
  const listed = [];
  attempt(() => { for (const key in below) listed.push(key); });
  out.push("for-in:" + listed.slice(0, 12).join());
  out.push("above:" + attempt(() => Object.getPrototypeOf(below) === parent) + attempt(() => Reflect.getPrototypeOf(below) === parent) + attempt(() => below.__proto__ === parent));
  out.push("instanceof:" + attempt(() => below instanceof Object) + attempt(() => Object.prototype.isPrototypeOf(below)) + attempt(() => Object.prototype.isPrototypeOf.call(parent, below)));
  out.push("text:" + attempt(() => Object.prototype.toString.call(below)) + attempt(() => kind(below.toString)) + attempt(() => kind(below.valueOf)) + attempt(() => kind(below.hasOwnProperty)) + attempt(() => kind(below.constructor)));
  out.push("keys:" + attempt(() => Object.keys(below).join()) + "|" + attempt(() => JSON.stringify(below)));
  return out.join(" ");
}
// Written names, read and called in line.
function written(parent) {
  const below = Object.create(parent);
  try { below.own = 1; } catch (e) {}
  return [attempt(() => kind(below.toString)), attempt(() => kind(below.url)), attempt(() => kind(below.length)), attempt(() => kind(below.name)), attempt(() => kind(below.then)), attempt(() => kind(below.size)), attempt(() => kind(below.env)), attempt(() => kind(below.exports)), attempt(() => "toString" in below), attempt(() => String(below).slice(0, 24)), attempt(() => below.own)].join(" ");
}
// Stores under names that may stand above the object, each on an object of its own.
function store(parent, names) {
  const out = [];
  for (const name of names) {
    const below = Object.create(parent);
    out.push(String(name) + ":" + [attempt(() => { below[name] = 5; return kind(below[name]); }), attempt(() => Object.hasOwn(below, name)), attempt(() => Reflect.set(Object.create(parent), name, 6)), attempt(() => delete below[name]), attempt(() => name in below)].join());
  }
  const written = Object.create(parent);
  try { written.first = 0; } catch (e) {}
  out.push("written:" + [attempt(() => { written.url = 1; return written.url; }), attempt(() => { written.length = 2; return written.length; }), attempt(() => { written.name = 3; return written.name; }), attempt(() => { written.size = 4; return written.size; }), attempt(() => { written.toString = 5; return written.toString; }), attempt(() => Object.keys(written).join())].join());
  return out.join(" ");
}
holder.store = store;
holder.ask = ask;
holder.written = written;
const names = ["toString", "hasOwnProperty", "constructor", "own", "nothing", "url", "length", "name", "prototype", "then", "size", "env", "exports", "__proto__", Symbol.iterator, Symbol.toStringTag, 0];
const show = (parent) => { for (let turn = 0; turn < 2; turn++) console.log(holder.ask(parent, names), "//", holder.written(parent), "//", holder.store(parent, names)); };
show(Object.freeze({ url: "f", size: 1 }));
show(Object.seal({ url: "s" }));
show(Object.preventExtensions({ url: "c" }));
show(Object.freeze([1, 2]));
