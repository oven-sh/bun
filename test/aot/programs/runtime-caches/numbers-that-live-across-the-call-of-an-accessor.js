// Numbers with fractions are held while a read or a store by name calls a getter, a setter or an accessor of the host,
// each of which computes with numbers of its own. Every held number has to be what it was.
const made = JSON.parse('[{"a":1.5},{"a":2.5},{"a":3.5}]');
let calls = 0;
function churn(seed) {
  let a = seed + 0.125, b = seed * 1.5, c = seed / 3, d = seed - 0.75, e = seed * seed, f = Math.sqrt(seed + 2), g = a * b, h = c * d;
  for (let i = 0; i < 3; i++) { a += b * c; b -= d / (e + 1); c *= 1.0625; d += f; e -= g * 0.001; f /= 1.03125; g += h; h -= a * 0.0001; }
  return a + b + c + d + e + f + g + h;
}
for (const object of made) {
  Object.defineProperty(object, "computed", { get() { calls++; return churn(this.a); }, set(value) { calls++; this.kept = churn(value); }, configurable: true });
}
function throughGetter(object, x) {
  const p = x * 1.1, q = x * 2.2, r = x * 3.3, s = x * 4.4, t = x * 5.5, u = x * 6.6, v = x * 7.7, w = x * 8.8;
  const got = object.computed;
  return p + q * 2 + r * 3 + s * 4 + t * 5 + u * 6 + v * 7 + w * 8 + got;
}
function throughSetter(object, x) {
  const p = x / 1.1, q = x / 2.2, r = x / 3.3, s = x / 4.4, t = x / 5.5, u = x / 6.6, v = x / 7.7, w = x / 8.8;
  object.computed = x;
  return p + q * 2 + r * 3 + s * 4 + t * 5 + u * 6 + v * 7 + w * 8 + object.kept;
}
function throughKey(object, key, x) {
  const p = x + 0.1, q = x + 0.2, r = x + 0.3, s = x + 0.4, t = x + 0.5, u = x + 0.6;
  const got = object[key];
  object[key] = p;
  return p * q * r + s * t * u + got + object.kept;
}
function throughHost(hosts, x) {
  const p = x * 0.5, q = x * 0.25, r = x * 0.125, s = x * 0.0625, t = x * 0.03125, u = x * 1.5;
  let length = 0;
  for (const host of hosts) length += String(host.href ?? host.byteLength ?? host.size).length;
  return p + q + r + s + t + u + length;
}
const hosts = [new URL("https://example.com/a/b?c=d"), new Uint8Array(12), new Blob(["abc"])];
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const object = made[i % 3];
  sum += throughGetter(object, i + 0.5);
  sum += throughSetter(object, i + 0.25);
  sum += throughKey(object, "computed", i + 0.75);
  sum += throughHost(hosts, i + 0.375);
}
console.log(sum.toFixed(3), calls);
console.log(throughGetter(made[0], 1.5).toFixed(6), throughSetter(made[1], 2.5).toFixed(6), throughKey(made[2], "computed", 3.5).toFixed(6), throughHost(hosts, 4.5).toFixed(6));
