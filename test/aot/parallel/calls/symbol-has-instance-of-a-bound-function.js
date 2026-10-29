function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.sum = function () { return this.x + this.y; };
const P = Point;
function say(n, f) { let r; try { r = JSON.stringify(f()); } catch (e) { r = "throws " + e.constructor.name + ": " + e.message; } console.log(n + ": " + r); }
say("member", () => { const B = Point.bind(null); return typeof B[Symbol.hasInstance]; });
say("same", () => { const B = Point.bind(null); return B[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance]; });
say("member call", () => { const B = Point.bind(null); return B[Symbol.hasInstance](new P(1, 2)); });
say("call", () => { const B = Point.bind(null); return Function.prototype[Symbol.hasInstance].call(B, new P(1, 2)); });
say("call, other", () => { const B = Point.bind(null); return Function.prototype[Symbol.hasInstance].call(B, {}); });
say("apply", () => { const B = Point.bind(null); return Reflect.apply(Function.prototype[Symbol.hasInstance], B, [new P(1, 2)]); });
say("instanceof", () => { const B = Point.bind(null); return new P(1, 2) instanceof B; });
