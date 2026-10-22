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

function Range(from, to) {
  this.from = from;
  this.to = to;
}
Range.prototype.shift = function (by) {
  return new this.constructor(this.from + by, this.to + by);
};
Range.prototype.span = function () {
  return this.to - this.from;
};

function Interval(from, to) {
  Range.call(this, from, to);
  this.closed = true;
}
Interval.prototype = Object.create(Range.prototype);

function Fixed(from, to) {
  Range.call(this, from, to);
  this.fixed = true;
}
Fixed.prototype = Object.create(Range.prototype);
Fixed.prototype.constructor = Fixed;

function Literal(from, to) {
  Range.call(this, from, to);
}
Literal.prototype = {
  shift: Range.prototype.shift,
  span: Range.prototype.span,
};

function Backwards(from, to) {
  this.to = from;
  this.from = to;
}
Backwards.prototype.span = function () {
  return "backwards span";
};

function shifted(range) {
  return range.shift(1);
}

function spanOf(range) {
  return range.span();
}

function look(label, range) {
  attempt(label + ": shift(1)", () => shifted(range));
  attempt(label + ": the shifted one is a Range, Interval, Fixed", () => { const next = shifted(range); return [next instanceof Range, next instanceof Interval, next instanceof Fixed]; });
  attempt(label + ": span of the shifted one", () => spanOf(shifted(range)));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += spanOf(shifted(new Range(i % 5, 10)));
console.log("2000 honest shifts", sum);

look("a range", new Range(1, 5));
look("a child that never set constructor", new Interval(1, 5));
look("a child that set constructor", new Fixed(1, 5));
look("a child whose prototype is a literal", new Literal(1, 5));

const own = new Range(1, 5);
own.constructor = Backwards;
look("a range with its own constructor member", own);

const arrow = new Range(1, 5);
arrow.constructor = (from, to) => ({ from, to });
look("constructor is an arrow function", arrow);

const number = new Range(1, 5);
number.constructor = 5;
look("constructor is a number", number);

const bare = Object.setPrototypeOf(new Range(1, 5), { shift: Range.prototype.shift, __proto__: null });
look("no constructor anywhere", bare);

const getter = Object.defineProperty(new Range(1, 5), "constructor", { get() { return this.from > 1 ? Backwards : Fixed; } });
look("constructor is a getter", getter);

Range.prototype.constructor = Backwards;
look("Range.prototype.constructor was replaced, a range", new Range(1, 5));
look("Range.prototype.constructor was replaced, a child that never set it", new Interval(1, 5));
look("Range.prototype.constructor was replaced, a child that set it", new Fixed(1, 5));

delete Range.prototype.constructor;
look("Range.prototype.constructor was deleted, a range", new Range(1, 5));

Range.prototype[["construct", "or"].join("")] = Range;
look("a store under a joined name put it back, a range", new Range(1, 5));
attempt("constructor is enumerable now", () => { const names = []; for (const name in new Range(1, 5)) names.push(name); return names; });
