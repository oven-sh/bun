const o = { a: 0, b: 0, c: 0, d: 0, e: 0, f: "", g: "" };
function read() {
  return o.a + o.b + o.c + o.d + o.e + o.f + o.g;
}
const k = Date.now() > 0 ? 1 : 0;
const x = k === 1 ? (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", 3.5) : (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", 21.5);
const y = k === 0 ? (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", 3.5) : (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", 24.5);
const z = k === 0 ? (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", NaN) : (o.a = 1, o.b = 2, o.c = 3, o.d = 4, o.e = 5, o.f = "f", o.g = "g", -0.5);
console.log(x, y, z, read());
