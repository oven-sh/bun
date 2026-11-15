// Methods of a parent, by every idiom that sets the parent.
class ExtendedBase { constructor(n) { this.n = n; this.i = 0; } step() { this.i = (this.i + 1) & 1023; return this.i; } get() { return this.n; } }
class Extended extends ExtendedBase { own() { return this.get(); } }
var extended = [new Extended(1), new Extended(2), new Extended(3), new Extended(4)];
function Alone(n) { this.n = n; this.i = 0; }
Alone.prototype = { step: function () { this.i = (this.i + 1) & 1023; return this.i; }, get: function () { return this.n; }, own: function () { return this.get(); } };
var alone = [new Alone(1), new Alone(2), new Alone(3), new Alone(4)];
function CreatedBase(n) { this.n = n; this.i = 0; }
CreatedBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
CreatedBase.prototype.get = function () { return this.n; };
function Created(n) { this.n = n; this.i = 0; }
Created.prototype = Object.create(CreatedBase.prototype);
Created.prototype.own = function () { return this.get(); };
var created = [new Created(1), new Created(2), new Created(3), new Created(4)];
function _inheritsLoose(t, o) { t.prototype = Object.create(o.prototype), t.prototype.constructor = t, Object.setPrototypeOf(t, o); }
function BabelBase(n) { this.n = n; this.i = 0; }
BabelBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
BabelBase.prototype.get = function () { return this.n; };
var Babel = (function (_Base) { function Babel(n) { return _Base.call(this, n) || this; } _inheritsLoose(Babel, _Base); Babel.prototype.own = function () { return this.get(); }; return Babel; })(BabelBase);
var babel = [new Babel(1), new Babel(2), new Babel(3), new Babel(4)];
var __extends = (function () { var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || function (d, b) { d.__proto__ = b; }; return extendStatics(d, b); }; return function (d, b) { extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); }; })();
function TypeScriptBase(n) { this.n = n; this.i = 0; }
TypeScriptBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
TypeScriptBase.prototype.get = function () { return this.n; };
var TypeScript = (function (_super) { __extends(TypeScript, _super); function TypeScript(n) { var _this = _super.call(this, n) || this; return _this; } TypeScript.prototype.own = function () { return this.get(); }; return TypeScript; })(TypeScriptBase);
var typeScript = [new TypeScript(1), new TypeScript(2), new TypeScript(3), new TypeScript(4)];
function MadeBase(n) { this.n = n; this.i = 0; }
MadeBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
MadeBase.prototype.get = function () { return this.n; };
function Made(n) { this.n = n; this.i = 0; }
Made.prototype = new MadeBase(0);
Made.prototype.own = function () { return this.get(); };
var made = [new Made(1), new Made(2), new Made(3), new Made(4)];
const util = require("node:util");
function UtilBase(n) { this.n = n; this.i = 0; }
UtilBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
UtilBase.prototype.get = function () { return this.n; };
function Util(n) { this.n = n; this.i = 0; }
util.inherits(Util, UtilBase);
Util.prototype.own = function () { return this.get(); };
var utils = [new Util(1), new Util(2), new Util(3), new Util(4)];
function LiteralBase(n) { this.n = n; this.i = 0; }
LiteralBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
LiteralBase.prototype.get = function () { return this.n; };
function Literal(n) { this.n = n; this.i = 0; }
Literal.prototype = { __proto__: LiteralBase.prototype, own: function () { return this.get(); } };
var literals = [new Literal(1), new Literal(2), new Literal(3), new Literal(4)];
function AssignedBase(n) { this.n = n; this.i = 0; }
AssignedBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
AssignedBase.prototype.get = function () { return this.n; };
function Assigned(n) { this.n = n; this.i = 0; }
Assigned.prototype = { own: function () { return this.get(); } };
Assigned.prototype.__proto__ = AssignedBase.prototype;
var assigned = [new Assigned(1), new Assigned(2), new Assigned(3), new Assigned(4)];
function SetBase(n) { this.n = n; this.i = 0; }
SetBase.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
SetBase.prototype.get = function () { return this.n; };
function Set_(n) { this.n = n; this.i = 0; }
Set_.prototype = { own: function () { return this.get(); } };
Object.setPrototypeOf(Set_.prototype, SetBase.prototype);
var set = [new Set_(1), new Set_(2), new Set_(3), new Set_(4)];
class SharedBase { constructor(n) { this.n = n; this.i = 0; } step() { this.i = (this.i + 1) & 1023; return this.i; } get() { return this.n; } }
class First extends SharedBase { own() { return this.get(); } }
class Second extends SharedBase { own() { return this.get() + 1; } }
var shared = [new First(1), new Second(2), new First(3), new First(4)];
const loops = {
  "a class that extends": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = extended[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "no parent": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = alone[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "Object.create": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = created[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "Babel": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = babel[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "TypeScript": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = typeScript[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "an instance of the parent": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = made[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "util.inherits": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = utils[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "__proto__ in a literal": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = literals[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "__proto__ assigned": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = assigned[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "Object.setPrototypeOf": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = set[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
  "two children of one parent": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { var d = shared[i & 3]; s = (s + d.step() + d.own()) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
