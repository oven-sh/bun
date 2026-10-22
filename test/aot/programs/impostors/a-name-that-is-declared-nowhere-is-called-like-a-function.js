function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function note(what) {
  log.push(what);
  return what;
}

function callIt() {
  return declaredNowhere(1);
}

attempt("called", () => declaredNowhere(1));
attempt("called from a function", callIt);
attempt("the arguments are not evaluated", () => declaredNowhere(note("argument")));
attempt("called if it is there", () => declaredNowhere?.(note("argument")));
attempt("with new", () => new declaredNowhere(note("argument")));
attempt("as a tag", () => declaredNowhere`a${note("value")}b`);
attempt("through call", () => declaredNowhere.call(null, note("argument")));
attempt("handed to map", () => [1].map(declaredNowhere));
attempt("on the right of instanceof", () => note("left") instanceof declaredNowhere);
attempt("typeof does not throw", () => typeof declaredNowhere);
attempt("as a member of the global object", () => globalThis.declaredNowhere);
attempt("as a member of the global object, called", () => globalThis.declaredNowhere(note("argument")));

globalThis.declaredNowhere = value => "now it is there: " + value;
attempt("after the global object got it", () => declaredNowhere(1));
attempt("from the same function as before", callIt);
attempt("typeof", () => typeof declaredNowhere);
globalThis.declaredNowhere = "a string";
attempt("after it became a string", () => declaredNowhere(note("argument")));
attempt("from the same function", callIt);
Object.defineProperty(globalThis, "declaredNowhere", { get: () => (log.push("get"), value => "from a getter: " + value), configurable: true });
attempt("after it became a getter", () => declaredNowhere(note("argument")));
attempt("from the same function", callIt);
delete globalThis.declaredNowhere;
attempt("after it was deleted", () => declaredNowhere(1));
attempt("from the same function", callIt);
