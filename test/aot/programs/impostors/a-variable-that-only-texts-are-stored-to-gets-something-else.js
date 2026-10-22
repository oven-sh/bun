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

let current = "start";

function setCurrent(value) {
  current = value;
}

function lengthOfCurrent() {
  return current.length;
}

function upperCurrent() {
  return current.toUpperCase();
}

function currentIsStart() {
  return current === "start";
}

function withADefault(text = "default") {
  return text.length + ":" + text.toUpperCase();
}

function withADefaultInAPattern({ text = "default" } = {}) {
  return text.length + ":" + text.toUpperCase();
}

function chosen(flag, other) {
  let text = "first";
  if (flag === 1) text = "second";
  if (flag === 2) text = other;
  return text.length;
}

function orDefault(text) {
  const used = text || "default";
  return used.length;
}

function nullishDefault(text) {
  const used = text ?? "default";
  return used.length;
}

function conditional(flag, other) {
  const used = flag ? "yes" : other;
  return used.toUpperCase();
}

function lastOf(values) {
  let last = "";
  for (const value of values) last = value;
  return last.length;
}

const state = { name: "start" };

function nameLength() {
  return state.name.length;
}

class Holder {
  text = "initial";
  static shared = "shared";
  size() {
    return this.text.length;
  }
  static size() {
    return Holder.shared.length;
  }
}

for (let i = 0; i < 2000; i++) {
  setCurrent(i % 2 ? "start" : "other");
  lengthOfCurrent();
  upperCurrent();
  currentIsStart();
  withADefault();
  withADefault("given");
  withADefaultInAPattern({ text: "given" });
  chosen(i % 2, "x");
  orDefault("given");
  nullishDefault("given");
  conditional(true, "no");
  lastOf(["a", "b"]);
  nameLength();
  new Holder().size();
  Holder.size();
}

const values = ["'text'", "''", "new String('wrapped')", "['a', 'b']", "{ length: 'look alike', toUpperCase() { return 'LOOK ALIKE'; } }", "5", "0", "null", "undefined", "Symbol('s')", "false", "Buffer.from('ab')"];

for (const text of values) {
  attempt("the variable holds " + text, () => {
    setCurrent(make(text));
    return [lengthOfCurrent(), currentIsStart()];
  });
  attempt("the variable holds " + text + ": method", () => upperCurrent());
  attempt("a default and " + text, () => withADefault(make(text)));
  attempt("a default in a pattern and " + text, () => withADefaultInAPattern({ text: make(text) }));
  attempt("chosen " + text, () => chosen(2, make(text)));
  attempt("|| " + text, () => orDefault(make(text)));
  attempt("?? " + text, () => nullishDefault(make(text)));
  attempt("? : " + text, () => conditional(false, make(text)));
  attempt("last of " + text, () => lastOf(["a", make(text)]));
  attempt("a member holds " + text, () => {
    state[make("'name'")] = make(text);
    return nameLength();
  });
  attempt("a field holds " + text, () => {
    const holder = new Holder();
    holder[make("'text'")] = make(text);
    return holder.size();
  });
  attempt("a static field holds " + text, () => {
    Holder[make("'shared'")] = make(text);
    return Holder.size();
  });
}
setCurrent("start");
state.name = "start";
Holder.shared = "shared";
attempt("honest again", () => [lengthOfCurrent(), upperCurrent(), currentIsStart(), withADefault(), chosen(0), nameLength(), new Holder().size(), Holder.size()]);

console.log("bytes made in plain sight", Buffer.from("he").length);
