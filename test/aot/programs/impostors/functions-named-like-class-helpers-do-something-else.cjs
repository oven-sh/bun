const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
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

function Base(value) {
  this.value = value;
}
Base.prototype.who = function () {
  return "base " + this.value;
};

function Stranger(value) {
  this.value = "stranger's " + value;
}
Stranger.prototype.who = function () {
  return "stranger " + this.value;
};

function whoIs(thing) {
  return thing.who();
}

function family(label, link) {
  function Child(value) {
    Base.call(this, value);
  }
  attempt(label + ": link", () => link(Child, Base));
  let child;
  attempt(label + ": construct", () => (child = new Child(1)));
  attempt(label + ": who()", () => whoIs(child));
  attempt(label + ": instanceof Base", () => child instanceof Base);
  attempt(label + ": instanceof Stranger", () => child instanceof Stranger);
  attempt(label + ": super_", () => Child.super_);
  attempt(label + ": log", () => log.splice(0));
}

{
  const __extends = function (d, b) {
    log.push("does nothing");
  };
  family("__extends that does nothing", (d, b) => __extends(d, b));
}

{
  const __extends = function (b, d) {
    function __() { this.constructor = b; }
    __.prototype = d.prototype;
    b.prototype = new __();
  };
  family("__extends with its parameters named the other way round", (d, b) => __extends(d, b));
  family("the same, called with the parent first", (d, b) => __extends(b, d));
  Base.prototype = { who: function () { return "base " + this.value; } };
}

{
  const __extends = function (d, b) {
    d.prototype = Object.create(Stranger.prototype);
  };
  family("__extends that links to a stranger", (d, b) => __extends(d, b));
}

{
  const inherits = function (ctor, superCtor) {
    ctor.super_ = superCtor;
    log.push("only notes the parent");
  };
  family("inherits that only sets super_", (d, b) => inherits(d, b));
}

{
  const util = {
    inherits(ctor, superCtor) {
      Object.setPrototypeOf(ctor.prototype, Stranger.prototype);
    },
  };
  family("a local object named util whose inherits links to a stranger", (d, b) => util.inherits(d, b));
}

{
  const Object = {
    create(parent) {
      log.push("a local Object.create");
      return { who: () => "from a local Object" };
    },
    setPrototypeOf(target, parent) {
      log.push("a local Object.setPrototypeOf");
      return target;
    },
  };
  family("a local object named Object, create", (d, b) => void (d.prototype = Object.create(b.prototype)));
  family("a local object named Object, setPrototypeOf", (d, b) => void Object.setPrototypeOf(d.prototype, b.prototype));
}

{
  const _inherits = function (subClass, superClass) {
    subClass.prototype = Object.create(superClass.prototype, { who: { value: () => "overridden while linking" } });
  };
  family("_inherits that also overrides a method", (d, b) => _inherits(d, b));
}

{
  let calls = 0;
  const link = function (d, b) {
    d.prototype = Object.create((calls++ % 2 ? Stranger : b).prototype);
  };
  family("a helper that links to the parent on its first call", link);
  family("and to a stranger on its second", link);
  family("and to the parent on its third", link);
}

{
  const _classCallCheck = function (instance, Constructor) {
    log.push("never throws");
  };
  function Unchecked(value) {
    _classCallCheck(this, Unchecked);
    return { value, made: "without new" };
  }
  attempt("_classCallCheck that never throws", () => Unchecked(1));
  attempt("its log", () => log.splice(0));
}

let length = 0;
for (let i = 0; i < 2000; i++) length += whoIs(new Base(i % 10)).length;
console.log("2000 honest calls at the end", length);
