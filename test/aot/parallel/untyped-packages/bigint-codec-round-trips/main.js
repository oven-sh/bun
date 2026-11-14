// An untyped package and a program of it (round trips): varints, rationals, powers modulo, digits in any base
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
let bytes = []; const values = [0, 1, 127, 128, 300, 16384, 2 ** 31, 2 ** 53 - 1, 12345678901234567890n, 1n << 70n]; for (const v of values) bytes.push(...lib.encode(v)); say(bytes.length, bytes.join(' '));
let at = 0, n = 0; while (at < bytes.length) { const r = lib.decode(bytes, at); at = r.next; say(n, r.value, String(r.value) === String(values[n++]), at); } try { lib.decode([0x80, 0x80]); } catch (e) { say(e.message); }
for (let i = -20n; i < 20n; i += 3n) { const x = i * i * i * 1000003n + i; say(x, lib.zigzag(x), lib.unzigzag(lib.zigzag(x)) === x, lib.base(x, Number(i & 15n) + 2), lib.encode(lib.zigzag(x)).length); }
