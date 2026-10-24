function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

function Timer(start) {
  var self = this;
  var secret = start * 10;
  this.ticks = start;
  this.tick = function () {
    self.ticks++;
    return self.ticks;
  };
  this.tickThis = function () {
    this.ticks++;
    return this.ticks;
  };
  this.peek = function () {
    return secret;
  };
  this.poke = function (value) {
    secret = value;
    return self;
  };
}
Timer.prototype.tick = function () {
  return "the prototype's tick";
};
Timer.prototype.report = function () {
  return this.ticks + " ticks, secret " + this.peek();
};

function tick(timer) {
  return timer.tick();
}

function tickThis(timer) {
  return timer.tickThis();
}

function peek(timer) {
  return timer.peek();
}

function report(timer) {
  return timer.report();
}

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var honest = new Timer(i % 5);
  sum += tick(honest) + tickThis(honest) + peek(honest) + report(honest).length;
}
console.log("2000 honest timers", sum);

var one = new Timer(1);
var two = new Timer(100);
attempt("two timers keep their own state", function () { return [tick(one), tick(two), peek(one), peek(two)]; });
attempt("their methods are different functions", function () { return one.tick === two.tick; });
attempt("keys", function () { return Object.keys(one); });

attempt("tick detached still finds self", function () { var detached = one.tick; return [detached(), one.ticks]; });
attempt("tickThis detached", function () { var detached = one.tickThis; var result = detached(); delete globalThis.ticks; return result; });
attempt("one's tick on two", function () { two.tick = one.tick; return [tick(two), one.ticks, two.ticks]; });
attempt("one's tickThis on two", function () { two.tickThis = one.tickThis; return [tickThis(two), one.ticks, two.ticks]; });
attempt("one's peek on two", function () { two.peek = one.peek; return [peek(two), report(two)]; });
attempt("poke through one changes what two's borrowed peek sees", function () { one.poke("poked"); return [peek(one), peek(two)]; });

attempt("the own tick deleted, the prototype's shows", function () { var timer = new Timer(1); delete timer.tick; return tick(timer); });
attempt("a copy by spread still ticks the original", function () { var timer = new Timer(1); var copy = Object.assign({}, timer); return [tick(copy), copy.ticks, timer.ticks, tickThis(copy), copy.ticks]; });
attempt("an object that inherits from a timer", function () { var timer = new Timer(1); var child = Object.create(timer); return [tick(child), tickThis(child), Object.keys(child), timer.ticks, child.ticks]; });
attempt("a frozen timer", function () { var timer = Object.freeze(new Timer(1)); return [tick(timer), tickThis(timer), timer.poke(5) === timer, peek(timer)]; });
attempt("Timer called with a literal as this", function () { var literal = { ticks: "old" }; Timer.call(literal, 7); return [tick(literal), peek(literal), Object.keys(literal)]; });
attempt("Timer called twice with the same object", function () { var timer = new Timer(1); var firstPeek = timer.peek; Timer.call(timer, 2); return [firstPeek(), peek(timer), timer.ticks]; });
attempt("a timer with a string", function () { var timer = new Timer("3"); return [tick(timer), tickThis(timer), peek(timer)]; });
attempt("ticks replaced by a getter", function () { var timer = new Timer(1); Object.defineProperty(timer, "ticks", { get: function () { return 50; }, set: function () {} }); return [tick(timer), tickThis(timer), report(timer)]; });
attempt("a literal with the same names", function () { var literal = { ticks: 5, tick: function () { return "a literal's tick"; }, tickThis: function () { return ++this.ticks; }, peek: function () { return "a literal's secret"; }, report: Timer.prototype.report }; return [tick(literal), tickThis(literal), peek(literal), report(literal)]; });
attempt("peek replaced under a joined name", function () { var timer = new Timer(1); timer[["pe", "ek"].join("")] = function () { return "joined"; }; return [peek(timer), report(timer)]; });
attempt("honest again", function () { var timer = new Timer(2); return [tick(timer), tickThis(timer), peek(timer), report(timer)]; });
