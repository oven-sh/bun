// Alone: what is claimed of the heir's fields is a fact about the whole program: another maker of its objects takes the claim away.
// Reflect.construct(above, list, heir) runs the function above alone: the heir's own fields were never stored.
const see = o => [String(o.size), String(o.extra), "extra" in o, Object.keys(o).join(), typeof o.extra].join(" ");
var __extends = (function () { var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; }; return extendStatics(d, b); }; return function (d, b) { extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __()); }; })();
var Meter = (function () { function Meter(size) { this.size = size; this.n = 0; } return Meter; })();
var Sub = (function (_super) { __extends(Sub, _super); function Sub(size) { var _this = _super.apply(this, arguments) || this; _this.extra = "x"; return _this; } return Sub; })(Meter);
var s = new Sub(2), o = Reflect.construct(Meter, [9], Sub); console.log(see(s), "|", see(o), o instanceof Sub);
