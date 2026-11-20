const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
var Counter = function () { function Counter(step) { _classCallCheck(this, Counter); this.step = step; this.value = 0; }
  _createClass(Counter, [{ key: "bump", value: function bump() { this.value += this.step; return this; } }]);
  return Counter; }();
console.log(Object.getOwnPropertyNames(Counter.prototype).map((k) => typeof Counter.prototype[k]).join());
