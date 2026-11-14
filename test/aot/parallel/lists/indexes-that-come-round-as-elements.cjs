// x = p[x] in loops inside of loops: what enters is a counter, what comes round an element of an array of whole numbers that the loop also stores into; some elements are fractions, outside, holes, texts or change on the way.
"use strict";
var log = [], n = 24, ints = make(function (i) { return (i * 7919 + 13) % 1009; });
function make(f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function dump(a) { var s = a.length + ":"; for (var i = 0; i < 26; i++) s += (i in a ? (Object.is(a[i], -0) ? "-0" : a[i] !== null && typeof a[i] === "object" ? "o" : String(a[i])) : "_") + ","; return s; }
var f = {
  roots(odd, at) { var p = [], c = 0; for (var i = 0; i < n; i++) p[i] = ints[i] % n; if (at >= 0) p[at] = odd; for (var i = 0; i < n; i++) { var x = i, steps = 0; while (p[x] !== x && steps++ < 30) { p[x] = p[p[x]]; x = p[x]; } if (x === i) c++; } return c + " " + dump(p); },
  parents(odd, at) { var p = make(function (i) { return i % 3 ? i - i % 3 : i; }), c = 0; if (at >= 0) p[at] = odd; for (var i = 0; i < n; i++) { var x = i, steps = 0; while (p[x] !== x && steps++ < 30) x = p[x]; c += x === i ? 1 : 0; } return c; },
  joined(odd, at) { var p = [], c = 0; for (var i = 0; i < n; i++) p[i] = i; if (at >= 0) p[at] = odd; function find(x) { var steps = 0; while (p[x] !== x && steps++ < 30) { p[x] = p[p[x]]; x = p[x]; } return x; } for (var i = 0; i + 1 < n; i++) { var a = find(ints[i] % n), b = find(ints[i + 1] % n); if (a !== b) p[a] = b; } for (var i = 0; i < n; i++) if (find(i) === i) c++; return c + " " + dump(p); },
  cycles(odd, at) { var p = make(function (i) { return (ints[i] + i) % n; }), s = ""; if (at >= 0) p[at] = odd; for (var i = 0; i < n; i++) { var x = i, y = i, steps = 0; do { x = p[x]; y = p[p[y]]; } while (x !== y && steps++ < 40); s += x + ","; } return s; },
  failure(odd, at) { var p = make(function () { return 0; }); if (at >= 0) p[at] = odd; for (var i = 1, x = 0; i < n; i++) { var steps = 0; while (x > 0 && ints[i] % 3 !== ints[x] % 3 && steps++ < 30) x = p[x - 1]; if (ints[i] % 3 === ints[x] % 3) x++; p[i] = x; } return dump(p); },
  swapped(odd, at) { var p = make(function (i) { return (i + 5) % n; }), q = p.slice(); if (at >= 0) q[at] = odd; for (var i = 0; i < n; i++) { var x = i, steps = 0; while (steps++ < 9) { var next = p[x]; p[x] = q[next]; x = next; } q[i] = x; } return dump(p) + dump(q); },
  counted(odd, at) { var p = make(function (i) { return i * 7 % n; }), s = 0; if (at >= 0) p[at] = odd; for (var i = 0; i < n; i++) { var x = i; for (var k = 0; k < 5; k++) { s += p[x]; x = p[x]; } p[i] = x; } return s + " " + dump(p); },
  cut(odd, at) { var p = make(function (i) { return i ? i - 1 : 0; }), s = 0; for (var i = 0; i < n; i++) { var x = i, steps = 0; while (x && steps++ < 30) { x = p[x]; s += x; } if (i === at) p[3] = odd; if (i === 17) p.length = 9; } return s + " " + dump(p); },
  grown(odd, at) { var p = make(function (i) { return ints[i] % n; }), s = ""; if (at >= 0) p[at] = odd; for (var i = n - 1; i >= 0; i--) { var x = i, steps = 0; while (steps++ < 4) { p[x] = p[x] + 1; x = p[x]; } s += x + ";"; } return s + dump(p); },
};
var odd = [2.5, -1, 99, undefined, "7", "length", NaN, 2147483648, 4294967297, -0, null, true, 1e300, 3n, { valueOf() { log.push("value"); return 5; }, toString() { log.push("text"); return "6"; } }];
for (var name in f) {
  var lines = [f[name](0, -1), f[name](0, -1)];
  for (var o = 0; o < odd.length; o++) for (var at of [0, 5, 18]) { var answer; try { answer = f[name](odd[o], at); } catch (error) { answer = "threw " + error.name; } lines.push(o + " " + at + " " + answer + log.splice(0).join()); }
  lines.push(f[name](0, -1));
  console.log(name + "\n  " + lines.join("\n  "));
}
