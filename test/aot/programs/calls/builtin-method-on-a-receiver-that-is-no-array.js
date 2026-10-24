// In `o.m(..)` a built-in sees the receivers whose read of `m` answers it. Each of these is no array and finds an array method all the same.
class Item { constructor(n) { this.n = n; } }
const bump = item => { item.n += 1; return item; };
function viaOwnProperty() {
  function holder() {}
  holder.map = Array.prototype.map;
  const like = { length: 1, 0: new Item(1), map: Array.prototype.map };
  return [holder.map(bump).length, like.map(bump)[0].n, like[0].n];
}
function viaPrototype() {
  const heir = Object.create(Array.prototype); heir.push(new Item(2));
  const literal = { __proto__: Array.prototype, length: 1, 0: new Item(3) };
  return [heir.map(bump)[0].n, literal.slice()[0].n, literal.concat([new Item(4)]).length];
}
function viaGetter() {
  const like = { length: 1, 0: new Item(5), get filter() { return Array.prototype.filter; } };
  return like.filter(item => item.n === 5)[0].n;
}
function viaProxy() {
  const proxy = new Proxy({ length: 1, 0: new Item(6) }, { get(target, name) { return name === "map" ? Array.prototype.map : target[name]; } });
  return proxy.map(bump)[0].n;
}
function viaWrapper() {
  Number.prototype.slice = Array.prototype.slice;
  Boolean.prototype.map = Array.prototype.map;
  return [(5).slice().length, true.map(bump).length, "abc".slice(1)];
}
function viaArguments() {
  arguments.slice = Array.prototype.slice;
  return arguments.slice(1)[0].n;
}
class Sub extends Array { static get [Symbol.species]() { return Other; } }
class Other extends Array { tag() { return "other"; } }
function viaSpecies() {
  const sub = Sub.from([new Item(8)]);
  return [sub.map(bump).tag(), sub.slice().tag(), sub.filter(() => true)[0].n];
}
function mixed(flag) {
  const record = { slice() { return [new Item(10)]; } };
  const x = flag ? [new Item(9)] : record;
  return x.slice()[0].n;
}
function absent(x) { try { return x.map(bump).length; } catch (error) { return error.constructor.name; } }
console.log(viaOwnProperty().join(), viaPrototype().join(), viaGetter(), viaProxy(), viaWrapper().join(), viaArguments(0, new Item(7)), viaSpecies().join(), mixed(true), mixed(false));
console.log(absent(bump), absent({}), absent(undefined), absent(null), absent("s"), absent([new Item(11)]), absent(7));
