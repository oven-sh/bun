// Sloppy code changes a text parameter behind its back.
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

function changedThroughArguments(text) {
  arguments[0] = ["now", "a", "list"];
  return [typeof text, text.length];
}

function changedAfterTheTest(text) {
  if (typeof text === "string") {
    arguments[0] = { length: "from arguments" };
    return text.length;
  }
  return "not a text";
}

function changedInALoop(text) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(typeof text === "string" ? text.charCodeAt(0) : typeof text);
    if (i === 1) arguments[0] = 5;
  }
  return seen;
}

function changedByAHelper(text) {
  overwrite(arguments);
  return [typeof text, text.length];
}

function overwrite(list) {
  list[0] = ["overwritten"];
}

function parameterChangesArguments(text) {
  text = 5;
  return [typeof arguments[0], arguments.length];
}

function notAliasedWhenMissing(text) {
  arguments[0] = "stored";
  return [typeof text, arguments.length, arguments[0]];
}

function notAliasedWithADefault(text = "default") {
  arguments[0] = ["now", "a", "list"];
  return [typeof text, text.length];
}

function withAText(text) {
  with (text) {
    return [typeof length, typeof charAt, typeof toUpperCase === "function" ? toUpperCase() : "no method"];
  }
}

function withATextAndALocal(text) {
  var length = "the local";
  with (text) {
    length = "stored";
  }
  return length;
}

function undeclared(text) {
  leakedText = text;
  return typeof leakedText + " " + leakedText.length;
}

function declaredInABlock(text) {
  if (text.length > 0) {
    function helper() {
      return "from the block";
    }
  }
  return typeof helper === "function" ? helper() : typeof helper;
}

for (let i = 0; i < 2000; i++) {
  changedInALoop("hello");
  parameterChangesArguments("hello");
  withAText("hello");
  undeclared("hello");
  declaredInABlock("hello");
}

attempt("changed through arguments", () => changedThroughArguments("hello"));
attempt("changed after the test", () => changedAfterTheTest("hello"));
attempt("changed in a loop", () => changedInALoop("hello"));
attempt("changed by a helper", () => changedByAHelper("hello"));
attempt("the parameter changes arguments", () => parameterChangesArguments("hello"));
attempt("not aliased when the argument is missing", () => notAliasedWhenMissing());
attempt("not aliased with a default", () => notAliasedWithADefault("hello"));
for (const text of ["'hello'", "new String('hello')", "['h']", "{ length: 'own', charAt: 5 }", "5", "null", "undefined", "Symbol('s')"]) {
  attempt("with (" + text + ")", () => withAText(make(text)));
  attempt("a store inside with (" + text + ")", () => withATextAndALocal(make(text)));
  attempt("an undeclared variable holds " + text, () => undeclared(make(text)));
  attempt("declared in a block, given " + text, () => declaredInABlock(make(text)));
}
delete globalThis.leakedText;
/* Output:
changed through arguments -> ["object", 3]
changed after the test -> "from arguments"
changed in a loop -> [104, 104, "number", "number"]
changed by a helper -> ["object", 1]
the parameter changes arguments -> ["number", 1]
not aliased when the argument is missing -> ["undefined", 0, "stored"]
not aliased with a default -> ["string", 5]
with ('hello') -> ["number", "function", "HELLO"]
a store inside with ('hello') -> "the local"
an undeclared variable holds 'hello' -> "string 5"
declared in a block, given 'hello' -> "from the block"
with (new String('hello')) -> ["number", "function", "HELLO"]
a store inside with (new String('hello')) -> "the local"
an undeclared variable holds new String('hello') -> "object 5"
declared in a block, given new String('hello') -> "from the block"
with (['h']) -> ["number", "undefined", "no method"]
a store inside with (['h']) -> threw RangeError
an undeclared variable holds ['h'] -> "object 1"
declared in a block, given ['h'] -> "from the block"
with ({ length: 'own', charAt: 5 }) -> ["string", "number", "no method"]
a store inside with ({ length: 'own', charAt: 5 }) -> "the local"
an undeclared variable holds { length: 'own', charAt: 5 } -> "object own"
declared in a block, given { length: 'own', charAt: 5 } -> "undefined"
with (5) -> ["undefined", "undefined", "no method"]
a store inside with (5) -> "stored"
an undeclared variable holds 5 -> "number undefined"
declared in a block, given 5 -> "undefined"
with (null) -> threw TypeError
a store inside with (null) -> threw TypeError
an undeclared variable holds null -> threw TypeError
declared in a block, given null -> threw TypeError
with (undefined) -> threw TypeError
a store inside with (undefined) -> threw TypeError
an undeclared variable holds undefined -> threw TypeError
declared in a block, given undefined -> threw TypeError
with (Symbol('s')) -> ["undefined", "undefined", "no method"]
a store inside with (Symbol('s')) -> "stored"
an undeclared variable holds Symbol('s') -> "symbol undefined"
declared in a block, given Symbol('s') -> "undefined"
*/
