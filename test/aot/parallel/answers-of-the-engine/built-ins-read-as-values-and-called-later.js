// A built-in that is read as a value and called later, through a variable, a field, a parameter or `call`, without its `this` or as a constructor, is the same function: it answers as it does where it is called by its name.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function attempt(way) { try { return way(); } catch (error) { return error.name; } }
const convert = Number;
report(convert("5") + 1);
const table = { n: Number, s: String, b: Boolean, f: Math.floor };
report(table.n("7") * 2);
report(table.s(7) + 2);
report(table.b(0));
report(table.f(2.5));
function applyTo(way, value) { return way(value); }
report(applyTo(Number, "8") + 1);
report(applyTo(String, 8) + 1);
report(applyTo(value => value, "8") + 1);
report(applyTo(Math.abs, -8) + 1);
report(applyTo(parseInt, "8px") + 1);
function chosen(which) { let way = Number; if (which) way = String; return way("9") + 1; }
report(chosen(false));
report(chosen(true));
function chosenInLoop(count) { let way = Number; let all = ""; for (let i = 0; i < count; i++) { all += typeof way(i); way = i % 2 ? Number : String; } return all; }
report(chosenInLoop(4));
const { floor, min } = Math;
report(floor(2.5) + min(1, 2));
const at = "".charCodeAt;
report(attempt(() => at(0)));
report(at.call("xyz", 1));
report(at.call(123, 1));
report(attempt(() => at.call(null, 1)));
const push = [].push;
report(attempt(() => push(1)));
const target = [];
report(push.call(target, 7, 8) + target.join());
const resolve = Promise.resolve;
report(attempt(() => resolve(1)));
const isArray = Array.isArray;
report(isArray([]) + "" + isArray({}));
const of = Array.of;
report(of(1, 2).join());
function Other() { this.made = "by another"; }
report(Array.of.call(Other, 1).made);
report(typeof new Number(5) + typeof Number(5));
report(typeof new String("s") + typeof String("s"));
report(new Number("12") + 1);
report(attempt(() => new Math.floor(1)));
report(attempt(() => new parseInt("1")));
report(attempt(() => Symbol()) === undefined);
report(attempt(() => new Symbol()));
report(attempt(() => Map()));
report(attempt(() => Promise()));
report(typeof Date());
report(typeof new Date(0));
report(Reflect.construct(Number, ["3"], Other) instanceof Other);
report(typeof Reflect.construct(Number, ["3"], Other));
report("end");
