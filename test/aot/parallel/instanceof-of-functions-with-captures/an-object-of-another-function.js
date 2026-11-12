const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
var K = function () { var made = 0; function K(v) { made++; this.v = v; }
  K.count = function () { return made; };
  return K; }();
function J() { } console.log(new J() instanceof K, new K(1) instanceof J);
