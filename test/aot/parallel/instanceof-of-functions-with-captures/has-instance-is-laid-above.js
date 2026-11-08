const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
var K = function () { var made = 0; function K(v) { made++; this.v = v; }
  K.count = function () { return made; };
  return K; }();
var above = function () { }; Object.defineProperty(above, Symbol.hasInstance, { value: function (x) { return x === 7; } }); Object.setPrototypeOf(K, above); console.log(new K(1) instanceof K, 7 instanceof K);
