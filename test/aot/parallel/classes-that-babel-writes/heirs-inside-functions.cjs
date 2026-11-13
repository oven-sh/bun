// STATISTIC: KnownHelperCalls >= 4
"use strict";
// Babel's class helpers inside the strict function of a bundle.
(function (factory) { factory({}); })(function (exports) {
function _toPrimitive(t,r){if("object"!=typeof t||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||"default");if("object"!=typeof i)return i;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===r?String:Number)(t)}
function _toPropertyKey(t){var i=_toPrimitive(t,"string");return"symbol"==typeof i?i:i+""}
function _defineProperties(e,r){for(var t=0;t<r.length;t++){var o=r[t];o.enumerable=o.enumerable||!1,o.configurable=!0,"value"in o&&(o.writable=!0),Object.defineProperty(e,_toPropertyKey(o.key),o)}}function _createClass(e,r,t){return r&&_defineProperties(e.prototype,r),t&&_defineProperties(e,t),Object.defineProperty(e,"prototype",{writable:!1}),e}
function _classCallCheck(a,n){if(!(a instanceof n))throw new TypeError("Cannot call a class as a function")}
function _setPrototypeOf(t,e){return _setPrototypeOf=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},_setPrototypeOf(t,e)}
function _inherits(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),Object.defineProperty(t,"prototype",{writable:!1}),e&&_setPrototypeOf(t,e)}
function _getPrototypeOf(t){return _getPrototypeOf=Object.setPrototypeOf?Object.getPrototypeOf.bind():function(t){return t.__proto__||Object.getPrototypeOf(t)},_getPrototypeOf(t)}
function _isNativeReflectConstruct(){try{var t=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){})))}catch(t){}return(_isNativeReflectConstruct=function(){return!!t})()}
function _assertThisInitialized(e){if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e}
function _possibleConstructorReturn(t,e){if(e&&("object"==typeof e||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return _assertThisInitialized(t)}
function _callSuper(t,o,e){return o=_getPrototypeOf(o),_possibleConstructorReturn(t,_isNativeReflectConstruct()?Reflect.construct(o,e||[],_getPrototypeOf(t).constructor):o.apply(t,e))}
var log = [];
function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
function A(x) { _classCallCheck(this, A); this.x = x; this.target = this instanceof B; }
_createClass(A, [{ key: "get", value: function get() { return this.x; } }, { key: "size", get: function get() { return this.x + 1; } }], [{ key: "of", value: function of(x) { return new this(x); } }]);
var B = function (_A) {
  function B(x) {
    var _this;
    _classCallCheck(this, B);
    _this = _callSuper(this, B, [x]);
    _this.y = 2;
    return _this;
  }
  _inherits(B, _A);
  return _createClass(B, [{ key: "both", value: function both() { return this.get() + this.y + this.size; } }]);
}(A);
var C = function (_B) {
  function C() { _classCallCheck(this, C); return _callSuper(this, C, arguments); }
  _inherits(C, _B);
  return _createClass(C, [{ key: "both", value: function both() { return "C" + this.x; } }]);
}(B);
var b = new B(3), c = new C(4, 5);
attempt(() => [b.both(), c.both(), b.target, c.target, B.of(7).both(), C.of(8).both()]);
attempt(() => [b instanceof A, c instanceof B, Object.getPrototypeOf(B) === A, b.constructor === B, Reflect.ownKeys(c), Object.getPrototypeOf(b) === B.prototype]);
attempt(() => B(1));
attempt(() => C.call(b, 1));
attempt(() => Reflect.construct(B, [9], C).both());
attempt(() => Reflect.construct(C, [9], A).get());
attempt(() => new (class D extends B { constructor() { super(11); this.d = 1; } })().both());
function Old(x) { var _this3; if (!(this instanceof Old)) throw new TypeError("old"); _this3 = _possibleConstructorReturn(this, A.call(this, x)); _this3.old = 1; return _possibleConstructorReturn(_this3); }
Old.prototype = Object.create(A.prototype, { constructor: { value: Old } });
function Bad(v) { return _possibleConstructorReturn(this, v); }
function Early(v) { var _this4; if (v) _this4 = _callSuper(this, Early, [v]); return _assertThisInitialized(_this4); }
_inherits(Early, A);
attempt(() => [new Old(3).get(), new Old(4).old, new Bad({ q: 1 }).q, new Bad(undefined) instanceof Bad]);
for (const v of [1, null, "s", false, 0]) attempt(() => new Bad(v));
attempt(() => Bad.call(undefined, undefined));
attempt(() => new Early(5).get());
attempt(() => new Early(0));
attempt(() => Early(1));
attempt(() => B.call(Object.create(B.prototype), 6).both());
attempt(() => { Object.setPrototypeOf(C, A); var made = new C(7); Object.setPrototypeOf(C, B); return made.y + " " + made.x; });
var sum = 0;
for (var i = 0; i < 400; i++) sum += new B(i & 7).both() + new C(i & 3).x;
log.push(sum);
console.log(log.join("\n"));
});
