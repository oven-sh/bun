// A look alike made in one module is used as a text in another.
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const tools = await import("./text-" + make("'tools'") + ".js");
const { runHonestCallers } = await import("./honest-callers.js");
const values = await import("./look-" + make("'alikes'") + ".js");

console.log("honest callers", runHonestCallers(2000));

for (const name of ["lookAlike", "wrapped", "list", "number", "changing"]) {
  attempt("hash of " + name, () => tools.hash(values[name]));
  attempt("initials of " + name, () => tools.initials(values[name]));
  attempt("quoted " + name, () => tools.quoted(values[name]));
  attempt("is before m " + name, () => tools.isBeforeM(values[name]));
  attempt("shorten " + name, () => tools.default(values[name]));
  attempt("look up by " + name, () => tools.lookUp({ "look alike": "by the look-alike", "hello world": "by the text", 1234567: "by the number" }, values[name]));
}

values.change();
attempt("the export has changed: hash", () => tools.hash(values.changing));
attempt("the export has changed: shorten", () => tools.default(values.changing));
attempt("the export has changed: quoted", () => tools.quoted(values.changing));
attempt("the namespace is used as a table", () => [Object.keys(tools), "hash" in tools, tools[make("'quoted'")]("x"), typeof tools[Symbol.toStringTag], tools.missing]);
attempt("the namespace as a text", () => tools.quoted(tools));
console.log("honest callers again", runHonestCallers(10));
