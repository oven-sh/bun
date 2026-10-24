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

function replacedParameter(text, code) {
  const before = text.length;
  eval(code);
  return [before, typeof text, text.length];
}

function replacedLocal(code) {
  let text = "local";
  eval(code);
  return [typeof text, text.length, text + "!"];
}

function replacedInALoop(code) {
  let text = "abcdef";
  const seen = [];
  for (let i = 0; i < text.length && i < 8; i++) {
    seen.push(text.charCodeAt ? text.charCodeAt(i) : text[i]);
    if (i === 1) eval(code);
  }
  return seen;
}

function replacedAfterTheTest(text, code) {
  if (typeof text === "string") {
    eval(code);
    return [typeof text, text.length];
  }
  return "not a text";
}

function declaredByEval(code) {
  eval(code);
  return typeof declared === "undefined" ? "nothing declared" : [typeof declared, declared.length];
}

function readByEval(text) {
  return eval("text.length + ':' + typeof text");
}

function replacedInAClosure(code) {
  let text = "outer";
  const inner = () => eval(code);
  inner();
  return [typeof text, text.length];
}

function indirect(text) {
  (0, eval)("var text = [1, 2, 3]");
  const seen = [typeof text, text.length];
  delete globalThis.text;
  return seen;
}

for (let i = 0; i < 300; i++) {
  replacedParameter("hello", "");
  replacedLocal("");
  replacedInALoop("");
  replacedAfterTheTest("hello", "");
  readByEval("hello");
}

const codes = ["", "text = 'another text'", "text = [1, 2, 3]", "text = new String('wrapped')", "text = 5", "text = { length: 'look alike' }", "text = null", "text += 1", "text = text.split('')", "var text = [9]", "(() => { text = [1]; })()", "eval('text = [1, 2]')"];

for (const code of codes) {
  attempt("a parameter, " + JSON.stringify(code), () => replacedParameter("hello", code));
  attempt("a local, " + JSON.stringify(code), () => replacedLocal(code));
  attempt("in a loop, " + JSON.stringify(code), () => replacedInALoop(code));
  attempt("after the test, " + JSON.stringify(code), () => replacedAfterTheTest("hello", code));
  attempt("in a closure, " + JSON.stringify(code), () => replacedInAClosure(code));
}
attempt("declared by eval", () => [declaredByEval("var declared = 'text'"), declaredByEval("var declared = [1, 2]"), declaredByEval("let declared = 'hidden'"), declaredByEval("")]);
attempt("read by eval", () => [readByEval("hello"), readByEval(["a"]), readByEval(new String("hi")), readByEval(5)]);
attempt("read by eval: null", () => readByEval(null));
attempt("indirect eval does not reach the parameter", () => indirect("hello"));
