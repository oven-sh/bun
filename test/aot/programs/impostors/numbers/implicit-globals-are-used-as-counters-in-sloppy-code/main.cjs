function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function start() {
  hits = 0;
  misses = 0;
}

function hit() {
  hits++;
  return hits;
}

function miss() {
  misses += 1;
  return misses & 7;
}

function report() {
  return [hits, hits + 1, hits | 0, hits * 2, typeof hits, misses];
}

function throughThis() {
  this.hits++;
  return this.hits;
}

start();
for (var i = 0; i < 2000; i++) {
  hit();
  miss();
  throughThis();
}
console.log("after 2000 honest rounds", show(report()));

var late = [0.5, NaN, 2147483647, -0, "3", "", undefined, null, true, 3n, [4], { valueOf: function () { return 5; } }];
late.forEach(function (value) {
  var label = show(value);
  globalThis.hits = value;
  attempt("globalThis.hits = " + label + ": report", report);
  attempt("globalThis.hits = " + label + ": hit", function () { return [hit(), hits]; });
  globalThis["hi" + "ts"] = value;
  attempt("a computed name stores " + label + ": throughThis", function () { return [throughThis(), hits]; });
  (0, eval)("hits = 1");
  attempt("run-time text stores 1 after " + label, report);
});

attempt("the global is deleted", function () {
  delete globalThis.hits;
  return outcome(report);
});
attempt("incrementing a deleted global", function () { return outcome(hit); });
attempt("typeof a deleted global", function () { return typeof hits; });
attempt("the global becomes an accessor", function () {
  var reads = 0;
  Object.defineProperty(globalThis, "hits", {
    get: function () {
      return ++reads;
    },
    set: function () {},
    configurable: true,
  });
  return [report(), hit(), hit()];
});
attempt("legacy octal literals", function () { return [010, 010 + 1, 08, 09.5, 0777 | 0, -010]; });
delete globalThis.hits;
delete globalThis.misses;
