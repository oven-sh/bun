// Constructor functions store closures into `this`: constructed, called on other objects, chained in the ES5 way, constructed for another new.target, and with classes above and below.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

function Widget(name) {
  this.name = name;
  this.show = () => "widget " + this.name;
  this.plain = function () {
    return "plain";
  };
  this.rename = next => {
    this.name = next;
    return this;
  };
}
Widget.prototype.describe = function () {
  return this.show() + "/" + this.plain();
};

const widgets = [];
for (let i = 0; i < 20; i++) widgets.push(new Widget("w" + i));
say("made", widgets.map(widget => widget.describe()).slice(0, 4).join(), Object.keys(widgets[0]).join());
say("identity", widgets[1].show === widgets[1].show, widgets[1].show !== widgets[2].show, widgets[3].plain !== widgets[4].plain, widgets[5].rename("renamed").show(), widgets[5].name);

// Called on objects that something else made.
const literal = { before: 1 };
Widget.call(literal, "literal");
say("called on a literal", literal.show(), Object.keys(literal).join(), literal.show === literal.show);
const again = new Widget("first");
const firstShow = again.show;
Widget.call(again, "second");
say("called again", again.show(), firstShow(), firstShow !== again.show, Object.keys(again).join());
const frozen = Object.freeze({ name: "frozen" });
say("called on a frozen object", attempt(() => Widget.call(frozen, "x")), Object.keys(frozen).join());
const array = [];
Widget.apply(array, ["array"]);
say("called on an array", array.show(), Object.keys(array).join());
say("called on nothing", attempt(() => Widget("nobody")));
const withSetter = {
  log: [],
  set show(value) {
    this.log.push(typeof value);
  },
  get show() {
    return () => "from the getter";
  },
};
Widget.call(withSetter, "setter");
say("called on an object with a setter", withSetter.show(), withSetter.log.join(), Object.keys(withSetter).join());

// The ES5 chain.
function Button(name, label) {
  Widget.call(this, name);
  this.label = label;
  this.press = () => this.show() + " pressed " + this.label;
}
Button.prototype = Object.create(Widget.prototype);
Button.prototype.constructor = Button;
const buttons = [new Button("b1", "ok"), new Button("b2", "cancel")];
say("chain", buttons.map(button => button.press()).join(), buttons[0].describe(), Object.keys(buttons[0]).join(), buttons[0] instanceof Widget, buttons[0].show !== buttons[1].show);

// Another new.target.
class Other {
  other = () => "other";
}
for (const target of [Widget, Button, Other, Object, function () {}]) {
  const made = Reflect.construct(Widget, ["for"], target);
  say("for " + (target.name || "anonymous"), made.show(), Object.keys(made).join("+"), made instanceof Widget, Object.getPrototypeOf(made) === target.prototype, typeof made.other, typeof made.press);
}

// A class below a constructor function, and a constructor function used as a mixin for a class instance.
class Fancy extends Widget {
  sparkle = () => this.show() + " sparkles";
  constructor(name) {
    super(name);
    this.late = () => this.sparkle() + " late";
  }
}
const fancy = [new Fancy("f1"), new Fancy("f2")];
say("class below", fancy.map(one => one.late()).join(), Object.keys(fancy[0]).join(), fancy[0].sparkle !== fancy[1].sparkle, fancy[0].describe());
class Host {
  id = "host";
  constructor() {
    Widget.call(this, "hosted");
  }
}
say("mixin", new Host().show(), Object.keys(new Host()).join());

// A constructor that returns another object, or a primitive.
function Returns(kind) {
  this.own = () => "own " + kind;
  if (kind === "object") return { replaced: () => "replaced" };
  if (kind === "number") return 5;
}
say("returns", Object.keys(new Returns("object")).join(), new Returns("object").replaced(), Object.keys(new Returns("number")).join(), new Returns("number").own(), new Returns("none").own());

// The prototype of the function is replaced between constructions.
function Moving() {
  this.where = () => this.place;
}
Moving.prototype.place = "first";
const movedFirst = new Moving();
Moving.prototype = { place: "second" };
const movedSecond = new Moving();
say("prototype replaced", movedFirst.where(), movedSecond.where(), movedFirst.where !== movedSecond.where);

// Stores on some paths only, and in loops.
function Sometimes(n) {
  this.n = n;
  if (n % 2) this.odd = () => "odd " + this.n;
  for (let i = 0; i < n % 3; i++) this.last = () => i + ":" + this.n;
}
const sometimes = [];
for (let i = 0; i < 8; i++) sometimes.push(new Sometimes(i));
say("sometimes", sometimes.map(one => Object.keys(one).join("+") + "=" + (one.odd ? one.odd() : "-") + "," + (one.last ? one.last() : "-")).join(" "));

console.log(lines.join("\n"));
