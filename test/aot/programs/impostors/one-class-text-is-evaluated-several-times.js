function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function defineClass(tag) {
  return class Widget {
    #secret = tag + " secret";
    static kind = tag;
    constructor(value) {
      this.value = value;
    }
    label() {
      return tag + " " + this.value;
    }
    get doubled() {
      return tag + " " + this.value * 2;
    }
    reveal() {
      return this.#secret;
    }
    static owns(thing) {
      return #secret in thing;
    }
    static make(value) {
      return new Widget(value);
    }
  };
}

function defineFunction(tag) {
  function Widget(value) {
    this.value = value;
  }
  Widget.prototype.label = function () {
    return tag + " " + this.value;
  };
  Object.defineProperty(Widget.prototype, "doubled", {
    get() {
      return tag + " " + this.value * 2;
    },
  });
  Widget.kind = tag;
  Widget.make = function (value) {
    return new Widget(value);
  };
  return Widget;
}

function defineLiteralMaker(tag) {
  return {
    kind: tag,
    make(value) {
      return {
        value,
        label() {
          return tag + " " + this.value;
        },
        get doubled() {
          return tag + " " + this.value * 2;
        },
      };
    },
  };
}

function labelOf(widget) {
  return widget.label();
}

function doubledOf(widget) {
  return widget.doubled;
}

function valueOf(widget) {
  return widget.value;
}

function labelsOf(widgets) {
  const labels = [];
  for (let i = 0; i < widgets.length; i++) labels.push(widgets[i].label());
  return labels;
}

for (const [kind, define] of [
  ["class", defineClass],
  ["constructor function", defineFunction],
  ["literal", defineLiteralMaker],
]) {
  const First = define("first");
  const Second = define("second");
  const Third = define("third");

  let length = 0;
  for (let i = 0; i < 2000; i++) {
    const widget = First.make(i % 5);
    length += labelOf(widget).length + doubledOf(widget).length + valueOf(widget);
  }
  console.log(kind + ": 2000 widgets of the first evaluation", length);

  attempt(kind + ": labels", () => [labelOf(First.make(1)), labelOf(Second.make(1)), labelOf(Third.make(1)), labelOf(First.make(1))]);
  attempt(kind + ": getters", () => [doubledOf(First.make(1)), doubledOf(Second.make(1)), doubledOf(Third.make(1)), doubledOf(First.make(1))]);
  attempt(kind + ": in one loop", () => labelsOf([First.make(1), Second.make(2), First.make(3), Third.make(4)]));
  attempt(kind + ": statics", () => [First.kind, Second.kind, Third.kind]);
  attempt(kind + ": the first's label with a second one as this", () => First.make(0).label.call(Second.make(7)));

  if (kind === "literal") continue;

  attempt(kind + ": they are different functions with different prototypes", () => [First === Second, First.prototype === Second.prototype, First.prototype.label === Second.prototype.label]);
  attempt(kind + ": instanceof across evaluations", () => [First.make(1) instanceof First, First.make(1) instanceof Second, Second.make(1) instanceof First, Second.make(1) instanceof Second]);
  attempt(kind + ": constructors", () => [First.make(1).constructor === First, Second.make(1).constructor === First]);
  attempt(kind + ": new from outside", () => [labelOf(new First(1)), labelOf(new Second(1))]);

  if (kind === "class") {
    attempt(kind + ": private names belong to one evaluation", () => [First.owns(First.make(1)), First.owns(Second.make(1)), Second.owns(First.make(1)), Second.owns(Second.make(1))]);
    attempt(kind + ": reveal", () => [First.make(1).reveal(), Second.make(1).reveal()]);
    attempt(kind + ": the first's reveal with a second one as this", () => First.prototype.reveal.call(Second.make(1)));
  }

  First.prototype.label = function () {
    return "patched " + this.value;
  };
  attempt(kind + ": after the first's label was patched", () => labelsOf([First.make(1), Second.make(2), Third.make(3)]));
  delete Second.prototype.label;
  attempt(kind + ": after the second's label was deleted", () => [labelOf(First.make(1)), labelOf(Third.make(3))]);
  attempt(kind + ": the second one now", () => labelOf(Second.make(2)));
  Object.setPrototypeOf(Third.prototype, { extra: () => "only under the third" });
  attempt(kind + ": after the third's prototype got a parent", () => [typeof First.make(1).extra, typeof Second.make(1).extra, typeof Third.make(1).extra]);
  const moved = Object.setPrototypeOf(First.make(9), Third.prototype);
  attempt(kind + ": a first one moved under the third's prototype", () => [labelOf(moved), doubledOf(moved), moved instanceof First, moved instanceof Third]);

  const many = [];
  for (let i = 0; i < 20; i++) many.push(define("number " + i).make(i));
  attempt(kind + ": twenty more evaluations", () => labelsOf(many).join("; "));
}
