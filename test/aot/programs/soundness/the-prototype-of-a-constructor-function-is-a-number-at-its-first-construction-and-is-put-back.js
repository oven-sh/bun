var unseen = new Function("x", "return x");
function Base() {}
Base.prototype.who = function () { return "base " + this.a; };
function Made(x) { this.a = x; this.b = x + 1; }
Made.prototype = new Base();
function make(x) { return new Made(x); }
function describe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Made) + " " + (made instanceof Base) + " " + (Object.getPrototypeOf(made) === Object.prototype); }
var original = Made.prototype;
unseen(Made).prototype = 1;
function attempt(run) { try { return run(); } catch (error) { return "threw " + error.name; } }
for (var round = 0; round < 4; round++)
  console.log(attempt(function () { return describe(make(round)); }), attempt(function () { return describe(Reflect.construct(Made, [round])); }), attempt(function () { return describe(new (unseen(Made))(round)); }));
unseen(Made).prototype = original;
for (var round = 0; round < 4; round++)
  console.log(attempt(function () { return describe(make(round)); }), attempt(function () { return describe(Reflect.construct(Made, [round])); }), attempt(function () { return describe(new (unseen(Made))(round)); }));
