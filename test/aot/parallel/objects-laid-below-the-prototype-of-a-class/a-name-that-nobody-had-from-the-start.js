// An object of a class may be laid below an object that itself stands below the prototype object of the class (express does it to every request). It finds the members of its class as before,
// but for what the objects between have or get. Every caller of use() is in sight, so that its forms are typed: they look at the bit of the cell and ask the guards of the class. THE DEED: the object between has a name that no class declares.
const taken = [];
class K {
  constructor() { this.a = 1; }
  m() { return "K.m"; }
  n() { return "K.n"; }
  get g() { return "K.g"; }
}
class Other { m() { return "Other.m"; } get g() { return "Other.g"; } }
// Every form that looks past the object itself: a method and a getter above, a name that nobody has, a store that creates, `in`, instanceof, JSON, for-in, an index, the tag.
function use(k) {
  let late, method, other, getter;
  try { method = k.m(); } catch (e) { method = e.constructor.name; }
  try { other = k.n(); } catch (e) { other = e.constructor.name; }
  try { getter = k.g; } catch (e) { getter = e.constructor.name; }
  try { k.late = 5; late = k.late; } catch (e) { late = e.constructor.name; }
  const listed = [];
  for (const key in k) listed.push(key);
  return [method, other, getter, k.nothing, late, Object.hasOwn(k, "late"), "m" in k, "nothing" in k, k instanceof K, k instanceof Other, k.a, JSON.stringify(k), listed.join("+"), k[0], Object.prototype.toString.call(k), typeof k.hasOwnProperty].join();
}
function show(first, second, third, fourth) {
  console.log(use(first), second ? "| " + use(second) : "", third ? "| " + use(third) : "", fourth ? "| " + use(fourth) : "", taken.join());
}
function below(parent) {
  const made = new K();
  Object.setPrototypeOf(made, parent);
  return made;
}
const between = Object.create(K.prototype);
between.nothing = "between.nothing";
show(new K());
const two = below(between);
show(two, new K(), below(between));
show(two, new K(), below(between));

show(two, new K(), below(between));
show(two, new K(), below(between));
