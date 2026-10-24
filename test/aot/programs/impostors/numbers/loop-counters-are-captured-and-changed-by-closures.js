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

function sharedVar() {
  var readers = [];
  for (var i = 0; i < 3; i++) readers.push(function () { return i; });
  return readers.map(function (read) { return read(); });
}

function freshLet() {
  const readers = [];
  for (let i = 0; i < 3; i++) readers.push(() => i);
  return readers.map(read => read());
}

function letIncrementedLater() {
  const steppers = [];
  for (let i = 0; i < 3; i++) steppers.push(() => ++i);
  return [steppers.map(step => step()), steppers.map(step => step())];
}

function closureSkipsAhead(extra) {
  const seen = [];
  for (var i = 0; i < 8; i++) {
    var skip = function () {
      i += extra;
    };
    seen.push(i);
    if (i === 2) skip();
    if (seen.length === 10) break;
  }
  return [seen, i];
}

function closureReplacesTheCounter(replacement) {
  const seen = [];
  for (var i = 0; i < 8; i++) {
    var replace = function () {
      i = replacement;
    };
    seen.push(i);
    if (seen.length === 3) replace();
    if (seen.length === 8) break;
  }
  return [seen, i];
}

function letReplacedInTheBody(replacement) {
  const seen = [];
  const readers = [];
  for (let i = 0; i < 8; i++) {
    readers.push(() => i);
    seen.push(i);
    if (seen.length === 3) (() => (i = replacement))();
    if (seen.length === 8) break;
  }
  return [seen, readers.map(read => read())];
}

function callbackChangesTheCounter(list, replacement) {
  const seen = [];
  let i = 0;
  const visit = value => {
    seen.push(value, i);
    if (value === "c") i = replacement;
  };
  for (; i < list.length; i++) {
    [list[i]].forEach(visit);
    if (seen.length > 16) break;
  }
  return [seen, i];
}

function counterReadAfterTheLoop(limit) {
  let last = () => -1;
  for (var i = 0; i < limit; i++) last = () => i;
  return [i, last(), i | 0];
}

function indexKeptByATimer(list) {
  const picked = [];
  const later = [];
  for (var i = 0; i < list.length; i++) later.push(() => picked.push(list[i], i));
  later.forEach(run => run());
  return picked;
}

for (let round = 0; round < 500; round++) {
  sharedVar();
  freshLet();
  letIncrementedLater();
  closureSkipsAhead(1);
  closureReplacesTheCounter(4);
  letReplacedInTheBody(4);
  callbackChangesTheCounter(["a", "b", "c", "d"], 2);
  counterReadAfterTheLoop(3);
  indexKeptByATimer(["a", "b"]);
}

attempt("sharedVar", sharedVar);
attempt("freshLet", freshLet);
attempt("letIncrementedLater", letIncrementedLater);
attempt("indexKeptByATimer", () => indexKeptByATimer(["a", "b"]));
for (const value of [1, 3, "1", "", 0.5, -0, null, undefined, true, 1n, NaN, 2147483647, [1], { valueOf: () => 1 }]) {
  const label = show(value);
  attempt("closureSkipsAhead(" + label + ")", () => closureSkipsAhead(value));
  attempt("closureReplacesTheCounter(" + label + ")", () => closureReplacesTheCounter(value));
  attempt("letReplacedInTheBody(" + label + ")", () => letReplacedInTheBody(value));
  attempt("callbackChangesTheCounter(" + label + ")", () => callbackChangesTheCounter(["a", "b", "c", "d", "e"], value));
  attempt("counterReadAfterTheLoop(" + label + ")", () => counterReadAfterTheLoop(value));
}
