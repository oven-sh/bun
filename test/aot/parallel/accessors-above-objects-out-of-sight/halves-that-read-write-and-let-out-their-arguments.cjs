// The halves are ordinary functions: sloppy and strict `this`, `arguments` read, written and let out, a half that is also called, constructed and compared, a getter that replaces itself.
function Box(v) { this.v = v; }
var kept = [];
function getter() { kept.push(arguments); return arguments.length + ":" + typeof this + ":" + (this && this.v); }
function setter(v) { arguments[0] = 9; this.v = v + arguments.length; }
function strictSetter(v) { arguments[0] = 9; this.v = v + arguments.length; }
Object.defineProperty(Box.prototype, "loose", { get: getter, set: setter });
Object.defineProperty(Box.prototype, "tight", { get: function () { return typeof this; }, set: strictSetter });
function run(count) { var out = []; for (var i = 0; i < count; i++) { var b = new Box(i); b.loose = 1; out.push(b.loose); b.tight = 1; out.push(b.v, b.tight); } return out.join(); }
console.log(run(3), kept.length, kept[0].length);
console.log(getter.call(undefined) === getter(), getter.call(5), new getter() instanceof getter, Object.getOwnPropertyDescriptor(Box.prototype, "loose").get === getter);
console.log(Reflect.get(Box.prototype, "loose", 7), Reflect.get(Box.prototype, "tight", 7), Reflect.get(Box.prototype, "tight", undefined));
function Lazy() {} var made = 0;
Object.defineProperty(Lazy.prototype, "value", { configurable: true, get: function () { var v = ++made; Object.defineProperty(this, "value", { value: v }); return v; } });
function twice(list) { var total = 0; for (var i = 0; i < list.length; i++) total += list[i].value * 10 + list[i].value; return total; }
console.log(twice([new Lazy(), new Lazy(), new Lazy()]), made);
class Above extends Box { get loose() { return "above " + super.loose; } set loose(v) { super.loose = v + 1; } }
var a = new Above(0); a.loose = 1; console.log(a.loose, a.v);
