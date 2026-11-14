// Constructor functions and classes that are made again and again get closures of their own by loops; their objects meet at one call.
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function makeFunction(n) {
  function W(v) { this.v = v; }
  for (const k of ["get", "put"]) W.prototype[k] = function (x) { return n + k + x + this.v; };
  return W;
}
function makeClass(n) {
  class W { constructor(v) { this.v = v; } }
  ["get", "put"].forEach(k => { W.prototype[k] = function (x) { return n + k + x + this.v; }; });
  return W;
}
function makeNamed(n) {
  function W(v) { this.v = v; }
  W.prototype.get = function (x) { return n + "get" + x + this.v; };
  W.prototype.put = function (x) { return n + "put" + x + this.v; };
  return W;
}
function makeWrapped(n, source) {
  function W(v) { this.v = v; }
  Object.keys(source).forEach(k => { const f = source[k]; W.prototype[k] = function (x) { return n + f(this.v, x); }; });
  return W;
}
function makeRecord(n) {
  const r = { v: n };
  for (const k of ["get", "put"]) r[k] = function (x) { return n + k + x + this.v; };
  return r;
}
const source = { get: (v, x) => v + "-" + x, put: (v, x) => v + "+" + x };
function use(objects, turns, at, change) {
  let text = "";
  for (let i = 0; i < turns; i++) {
    if (i === at) attempt(change);
    const o = objects[i % objects.length];
    text += attempt(() => o.get(i)) + "," + attempt(() => o.put(1)) + " ";
  }
  return text;
}
function single(W, turns) {
  const w = new W(5);
  let text = "";
  for (let i = 0; i < turns; i++) text += w.get(i) + w.put(i) + " ";
  return text;
}
for (const make of [makeFunction, makeClass, makeNamed, n => makeWrapped(n, source)]) {
  const A = make("a"), B = make("b"), C = make("c");
  console.log(single(A, 4), single(B, 4), single(A, 2), single(C, 3));
  const objects = [new A(1), new B(2), new C(3), new A(4)];
  console.log(use(objects, 10, -1, () => {}));
  console.log(use(objects, 10, 4, () => { A.prototype.get = x => "new" + x; }));
  console.log(use(objects, 10, 3, () => { B.prototype.put = A.prototype.put; delete C.prototype.get; }));
  console.log(single(A, 2), attempt(() => single(C, 1)), single(B, 2));
  const D = make("d");
  console.log(single(D, 2), use([new D(9), ...objects], 10, 5, () => { D.prototype = B.prototype; }), attempt(() => new D(1).get(0)));
}
const records = [makeRecord("r"), makeRecord("s"), makeRecord("t")];
console.log(use(records, 9, 4, () => { records[0].get = records[1].get; delete records[2].put; }), JSON.stringify(records));
