// A function that returns strings returns something else once.
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

const names = { 1: "one", 2: "two", 3: "three" };

function nameOf(number) {
  return names[number];
}

function describe(value) {
  if (value === 0) return "zero";
  if (value < 0) return "negative";
  if (value > 100) return extra(value);
  return "positive";
}

let extra = value => "large";

function pick(flag, other) {
  return flag ? "picked" : other;
}

function textOrNothing(flag) {
  if (flag) return "text";
}

function fromTheCatch(run) {
  try {
    run();
    return "fine";
  } catch (error) {
    return error;
  }
}

function lengthOfName(number) {
  return nameOf(number).length;
}

function upperDescription(value) {
  return describe(value).toUpperCase();
}

function firstOfPick(flag, other) {
  return pick(flag, other)[0];
}

function labelOfText(flag) {
  return "<" + textOrNothing(flag) + ">";
}

function lengthOfText(flag) {
  return textOrNothing(flag).length;
}

function lengthFromTheCatch(run) {
  return fromTheCatch(run).length;
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  total += lengthOfName((i % 3) + 1) + upperDescription(i % 90).length + firstOfPick(true, "x").length + labelOfText(true).length + lengthOfText(true) + lengthFromTheCatch(() => {});
}
console.log("2000 honest rounds", total);

attempt("a name that is missing", () => lengthOfName(4));
attempt("a name that is inherited", () => lengthOfName("constructor"));
attempt("a name that is inherited and has no length", () => lengthOfName("__proto__"));
names[4] = 4;
attempt("a name that is a number", () => lengthOfName(4));
names[5] = ["f", "i", "v", "e"];
attempt("a name that is a list", () => lengthOfName(5));
names[6] = new String("six");
attempt("a name that is wrapped", () => [lengthOfName(6), typeof nameOf(6)]);
attempt("an honest name", () => lengthOfName(3));

attempt("a large value", () => upperDescription(101));
extra = value => value;
attempt("the helper now returns a number", () => upperDescription(101));
extra = value => ({ toUpperCase: () => "look alike" });
attempt("the helper now returns a look-alike", () => upperDescription(101));
extra = make("value => ['large']");
attempt("the helper now returns a list", () => upperDescription(101));
extra = () => undefined;
attempt("the helper now returns nothing", () => upperDescription(101));
attempt("NaN falls through every comparison", () => upperDescription(NaN));
attempt("a text is compared as a number", () => [upperDescription("0"), upperDescription("-5"), upperDescription("x"), upperDescription("")]);
attempt("null is not zero but is not negative", () => upperDescription(null));
attempt("an honest description", () => upperDescription(5));

attempt("the other is a list", () => firstOfPick(false, ["other"]));
attempt("the other is a number", () => firstOfPick(false, 5));
attempt("the other is null", () => firstOfPick(false, null));
attempt("the other is a wrapped text", () => firstOfPick(false, new String("other")));
attempt("the other is not used", () => firstOfPick(true, null));

attempt("nothing is returned: label", () => labelOfText(false));
attempt("nothing is returned: length", () => lengthOfText(false));
attempt("what was thrown is a text", () => lengthFromTheCatch(() => { throw "thrown text"; }));
attempt("what was thrown is an error", () => lengthFromTheCatch(() => { throw new RangeError("no"); }));
attempt("what was thrown is a list", () => lengthFromTheCatch(() => { throw [1, 2]; }));
attempt("what was thrown is null", () => lengthFromTheCatch(() => { throw null; }));
attempt("what was thrown is undefined", () => lengthFromTheCatch(() => { throw undefined; }));
attempt("what was thrown is a number", () => lengthFromTheCatch(() => { throw 5; }));
