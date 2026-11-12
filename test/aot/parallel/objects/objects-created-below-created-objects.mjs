// STATISTIC: ClosedPrototypeObjects >= 1
// Objects below objects below a literal: each constant that objects are created below is the prototype of a function.
const out = [];
function told(name, run) {
  try {
    out.push(`${name} ${run()}`);
  } catch (error) {
    out.push(`${name} ${error.name}: ${error.message}`);
  }
}
const Widget = { kind: "widget", size: 3, init(width) { this.width = width; return this; }, area() { return this.width * this.size; } };
const Button = Object.create(Widget);
Button.setup = function (width, label) { Widget.init.call(this, width); this.label = label; return this; };
Button.shown = function () { return `${this.kind} ${this.label}`; };
Button.kind = "button";
const Plain = { m() { return "plain"; } }, below = Object.create(Plain), Deep = Object.create(Button);
Deep.area = function () { return Button.area.call(this) + 1; };
below.n = 4;
function repeat(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) {
    const button = Object.create(Button).setup(k & 7, "b");
    n += button.area() + (button.label === "b" ? 1 : 0);
  }
  return n;
}
told("repeat", () => repeat(1000));
told("shown", () => Object.create(Button).setup(2, "two").shown());
told("deep", () => Object.create(Deep).setup(5, "deep").area());
told("above", () => Widget.isPrototypeOf(Object.create(Deep)) && Button.isPrototypeOf(Object.create(Deep)));
told("same", () => Object.getPrototypeOf(Object.create(Button)) === Button);
told("other", () => Object.getPrototypeOf(Button) === Widget);
told("names", () => { const names = []; for (const name in Object.create(Deep)) names.push(name); return names.join(); });
told("below", () => below.m() + below.n + Object.keys(below).join());
told("quoted", () => Widget.missing.call(1));
told("asked", () => Button === Widget);
told("constructor", () => Object.create(Deep).constructor === Object);
told("late", () => late.x);
Widget.size = 4;
told("changed", () => Object.create(Button).setup(2, "two").area());
told("keys", () => Object.keys(Object.getPrototypeOf(Object.create(Widget))).join());
const late = { x: 5, m() { return this.x; } };
told("of late", () => Object.create(late).m());
out.push(Object.keys(Button).join(), typeof Widget.init, Widget.area.name, Widget.size, "kind" in Deep, Deep.kind);
delete Button.kind;
out.push(Object.create(Deep).kind, { Widget: Widget }.Widget === Object.getPrototypeOf(Button));
try { Widget.missing(); } catch (error) { out.push(error.message); }
try { Widget(); } catch (error) { out.push(error.message); }
try { new Widget(); } catch (error) { out.push(error.message); }
try { Widget.missing.more; } catch (error) { out.push(error.message); }
console.log(out.join("\n"));
console.log(Widget, Button, Object.create(Deep).setup(1, "l"));
