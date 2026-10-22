const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function Report(title) {
  this.title = title;
}

Object.defineProperty(Report.prototype, "body", {
  get: function () {
    log.push("compute body of " + this.title);
    var body = "body of " + this.title;
    Object.defineProperty(this, "body", { value: body, writable: true, enumerable: true, configurable: true });
    return body;
  },
  configurable: true,
});

Object.defineProperty(Report.prototype, "cached", {
  get: function () {
    if (this._cached === undefined) {
      log.push("fill the cache of " + this.title);
      this._cached = this.title.length;
    }
    return this._cached;
  },
});

Report.prototype.tags = [];
Report.prototype.options = { color: "shared color" };
Report.prototype.visits = 0;

Report.prototype.addTag = function (tag) {
  this.tags.push(tag);
  return this.tags.length;
};
Report.prototype.visit = function () {
  this.visits++;
  return this.visits;
};
Report.prototype.paint = function (color) {
  this.options.color = color;
  return this.options.color;
};

function bodyOf(report) {
  return report.body;
}

function bodyTwice(report) {
  return [report.body, report.body];
}

function cachedOf(report) {
  return report.cached;
}

function visit(report) {
  return report.visit();
}

function visitsOf(report) {
  return report.visits;
}

var length = 0;
for (var i = 0; i < 2000; i++) {
  var honest = new Report("r" + (i % 4));
  length += bodyOf(honest).length + bodyTwice(honest).length + cachedOf(honest) + visit(honest) + visitsOf(honest);
}
log.length = 0;
console.log("2000 honest reports", length);

var report = new Report("first");
attempt("keys before any read", function () { return Object.keys(report); });
attempt("the first read computes", function () { return bodyOf(report); });
attempt("the second read does not", function () { return bodyOf(report); });
attempt("keys after the read", function () { return Object.keys(report); });
attempt("two reads in one function on a new report", function () { return bodyTwice(new Report("second")); });
attempt("a store before any read", function () { var fresh = new Report("third"); fresh.body = "stored"; return [bodyOf(fresh), Object.keys(fresh)]; });
attempt("a delete brings the getter back", function () { delete report.body; return bodyOf(report); });
attempt("a frozen report cannot keep its body", function () { return bodyTwice(Object.freeze(new Report("frozen"))); });
attempt("the prototype itself", function () { return bodyOf(Report.prototype); });
attempt("after that, a new report", function () { return [bodyOf(new Report("fourth")), Object.getOwnPropertyDescriptor(Report.prototype, "body").get === undefined]; });

attempt("the cache fills once", function () { var fresh = new Report("cache"); return [cachedOf(fresh), cachedOf(fresh), Object.keys(fresh)]; });
attempt("a cache that holds 0 is kept", function () { var fresh = new Report(""); return [cachedOf(fresh), cachedOf(fresh)]; });
attempt("a literal under the prototype", function () { return cachedOf({ __proto__: Report.prototype, title: "literal" }); });
attempt("a literal with a cache already", function () { return cachedOf({ __proto__: Report.prototype, _cached: "already" }); });
attempt("a literal without a title", function () { return cachedOf({ __proto__: Report.prototype }); });

var one = new Report("one");
var two = new Report("two");
attempt("tags pushed through one show up in the other", function () { return [one.addTag("a"), two.addTag("b"), one.tags, one.tags === two.tags, Object.hasOwn(one, "tags")]; });
attempt("a color painted through one shows up in the other", function () { return [one.paint("red"), two.options.color, Object.hasOwn(one, "options")]; });
attempt("visits++ makes an own member", function () { return [visit(one), visit(one), visitsOf(one), visitsOf(two), Report.prototype.visits, Object.hasOwn(one, "visits"), Object.hasOwn(two, "visits")]; });
Report.prototype.visits = 100;
attempt("after the shared count changed", function () { return [visitsOf(one), visitsOf(two), visit(two), visitsOf(two)]; });
Report.prototype.visits = "7";
attempt("after the shared count became a string", function () { var fresh = new Report("fresh"); return [visitsOf(fresh), visit(fresh), visitsOf(fresh)]; });
Object.defineProperty(Report.prototype, "visits", { value: 5, writable: false, configurable: true });
attempt("after the shared count became read-only", function () { var fresh = new Report("fresh"); return [visit(fresh), visitsOf(fresh), Object.hasOwn(fresh, "visits")]; });
delete Report.prototype.visits;
attempt("after the shared count was deleted", function () { var fresh = new Report("fresh"); return [visitsOf(fresh), visit(fresh), visitsOf(one)]; });
