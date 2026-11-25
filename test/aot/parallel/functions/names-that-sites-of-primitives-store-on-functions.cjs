function put(o, v) {
  o.n ??= v;
}
const h = () => 1;
function one(o) {
  put(o, 2.5);
}
one(h);
one(5);
one("text");
one({});
console.log(h.n);
function set(o, v) {
  o.m = v;
}
const g = () => 2;
function two(o) {
  set(o, 1);
}
two(g);
two(5);
two(true);
two({ m: 1 });
two(Symbol.iterator);
console.log(g.m, (5).m);
function write(o, v) {
  try {
    o.p = v;
    return o.p;
  } catch (error) {
    return error.constructor.name;
  }
}
const f = function () {};
console.log(write(f, 3), write(5, 3), write("s", 3), write({}, 3), write(null, 3), f.p);
