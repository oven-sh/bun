function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], (function () { }))); } catch (t) { } return (_isNativeReflectConstruct = function () { return !!t; })(); }
function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); return e; }
function _possibleConstructorReturn(t, e) { if (e && ("object" == typeof e || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); return _assertThisInitialized(t); }
function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _createClass(e, r, t) { return Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function Animal(name) { this.name = name; }
function makeHeir(Parent) { return function (_P) { function Heir(a, b) { var _this; _classCallCheck(this, Heir); _this = _callSuper(this, Heir, arguments); _this.count = arguments.length; return _this; } _inherits(Heir, _P); return _createClass(Heir); }(Parent); }
var Dog = function (_P) { function Dog(a, b) { var _this; _classCallCheck(this, Dog); _this = _callSuper(this, Dog, [a, b]); _this.kind = 'dog'; return _this; } _inherits(Dog, _P); return _createClass(Dog); }(Animal);
const say = run => { try { console.log(JSON.stringify(run())); } catch (error) { console.log(error.name, error.message); console.log(error.stack.split('\n').filter(line => line.includes('    at ')).slice(0, 3).map(line => line.trim().split(' (')[0]).join(', ')); } };
for (const Parent of [Animal, makeHeir(Animal), Symbol, BigInt]) {
    const Heir = makeHeir(Parent);
    say(() => new Heir('a'));
    say(() => new Heir('a', 2));
    say(() => Heir('a'));
}
say(() => new Dog('rex', 1));
let reads = 0;
function Seen() { }
Seen.prototype = Object.create(Dog.prototype, { constructor: { get() { reads++; return Seen; } } });
say(() => [Reflect.construct(Dog, ['seen'], Seen), reads]);
Object.setPrototypeOf(Dog, function Other(name) { this.other = name; });
say(() => [Reflect.construct(Dog, ['seen'], Seen), reads]);
for (const Parent of [Symbol, Math.max, null, {}]) {
    Object.setPrototypeOf(Dog, Parent);
    say(() => new Dog('rex', 1));
}
