(function (global, factory) { typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : factory(global.kit = {}); }(this, function (exports) { "use strict";
  function make() { return new Float32Array(2); }
  function scale(out, a, m) { out[0] = a[0] * m[0]; out[1] = a[1] * m[1]; return out; }
  function shift(out, a, m) { out[0] = a[0] + m[0]; out[1] = a[1] + m[1]; return out; }
  var pair = Object.freeze({ __proto__: null, make: make, scale: scale, shift: shift });
  var words = Object.freeze({ __proto__: null, join: function (a, b) { return a + "-" + b; } });
  exports.pair = pair; exports.words = words; Object.defineProperty(exports, "__esModule", { value: true });
}));
var kit = module.exports, out = kit.pair.make(), by = kit.pair.make(); by[0] = 2; by[1] = 3;
function sum(points) { var s = 0; for (var i = 0; i < points.length; i++) { kit.pair.scale(out, points[i], by); s += out[0] + out[1]; } return s; }
var n = +process.argv[2] || 3, points = []; for (var i = 0; i < 8; i++) points.push([i, i + 1]);
var total = 0; for (var t = 0; t < n; t++) total += sum(points);
console.log(total, kit.__esModule, kit.words.join("a", n));
