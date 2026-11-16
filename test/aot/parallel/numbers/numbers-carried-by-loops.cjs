// A value of unknown type enters a loop and numbers come round: the version of the loop asks for a number once, before it.
const show = v => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : typeof v === "object" ? "object" : typeof v === "function" ? "function" : String(v));
const list = a => a.length + ":" + Array.from({ length: Math.min(a.length, 8) }, (_, i) => (i in a ? show(a[i]) : "_")).join();
const log = [];
function Big(array) {
  this.array = array;
}
function digits(i, x, w, j, c, n) {
  var a = this.array,
    b = w.array;
  var xl = x & 0x3fff,
    xh = x >> 14;
  while (--n >= 0) {
    var l = a[i] & 0x3fff;
    var h = a[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return c;
}
function floors(i, x, w, j, c, n) {
  var a = this.array,
    b = w.array;
  while (--n >= 0) {
    var v = x * a[i++] + b[j] + c;
    c = Math.floor(v / 0x4000000);
    b[j++] = v & 0x3ffffff;
  }
  return c;
}
function last(i, x, w, j, c, n) {
  var a = this.array,
    b = w.array;
  for (; i < n; i++) {
    b[i] = (a[i] & 255) + c;
    c = a[i] & 15;
  }
  return c;
}
function joined(i, x, w, j, c, n) {
  var a = this.array,
    s = "";
  for (; i < n; i++) {
    s += c;
    c = a[i] & 7;
  }
  return s;
}
lay = function (name, f) {
  Big.prototype[name] = f;
};
for (const f of [digits, floors, last, joined]) lay(f.name, f);
const lists = {
  ints: () => [3, 1 << 27, 5, 268435455, 7, 200000000],
  negative: () => [-3, 1 << 27, -5, 0, 7, -200000000],
  doubles: () => [0.5, 268435456.5, 2.25, 7, 4, 5],
  holes: () => [1, , 3, 4, , 6],
  strings: () => [1, "300", 3, "x", 5, 6],
  short: () => [1, 2],
  objects: () => [1, { valueOf: () => log.push("v") + 3000 }, 3, 4, 5, 6],
};
const enters = [0, 5, -7, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 40, "7", "x", undefined, null, true, { valueOf: () => log.push("c") + 9 }, [3], 10n, Symbol.iterator, () => 1];
for (const name of ["digits", "floors", "last", "joined"]) {
  for (const kind of Object.keys(lists)) {
    const lines = [];
    for (const c of enters) {
      log.length = 0;
      const x = new Big(lists[kind]()),
        y = new Big(lists.ints());
      let r;
      try {
        r = show(x[name](0, 123456789, y, 0, c, 6));
      } catch (e) {
        r = e.name;
      }
      lines.push(r + " " + list(x.array) + " " + list(y.array) + log.join(""));
      try {
        r = show(y[name](0, -5, y, 1, c, 5));
      } catch (e) {
        r = e.name;
      }
      lines.push(r + " " + list(y.array));
    }
    console.log(name, kind, lines.join(" | "));
  }
}
