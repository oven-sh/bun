// Seven stores by name ahead of a loop that stores by computed keys do not overwrite a neighboring object.
let p;
function f(c) {
  const o = {};
  if (c) c();
  o.a = 1; o.b = 1; o.c = 1; o.d = 1; o.e = 1; o.f = 1; o.g = 1;
  for (const k in c) o[k] = 1;
  return o;
}
f(() => { p = JSON.parse('{"x":1}'); });
console.log(p.x);
