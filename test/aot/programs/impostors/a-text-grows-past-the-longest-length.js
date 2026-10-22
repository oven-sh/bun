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

function doubleUntilItFails() {
  let text = "ab";
  const lengths = [];
  try {
    for (let i = 0; i < 40; i++) {
      text = text + text;
      lengths.push(text.length);
    }
  } catch (error) {
    return [lengths.length, lengths[lengths.length - 1], error.constructor.name, text.length];
  }
  return "never failed";
}

function appendUntilItFails() {
  let text = "ab";
  let rounds = 0;
  try {
    for (; rounds < 40; rounds++) text += text;
  } catch (error) {
    return [rounds, error.constructor.name, text.length];
  }
  return "never failed";
}

function templateUntilItFails() {
  let text = "ab";
  let rounds = 0;
  try {
    for (; rounds < 40; rounds++) text = `${text}${text}`;
  } catch (error) {
    return [rounds, error.constructor.name, text.length];
  }
  return "never failed";
}

function concatUntilItFails() {
  let text = "ab";
  let rounds = 0;
  try {
    for (; rounds < 40; rounds++) text = text.concat(text);
  } catch (error) {
    return [rounds, error.constructor.name, text.length];
  }
  return "never failed";
}

attempt("text = text + text", doubleUntilItFails);
attempt("text += text", appendUntilItFails);
attempt("a template", templateUntilItFails);
attempt("concat", concatUntilItFails);
attempt("repeat with too large a count", () => "ab".repeat(2 ** 31));
attempt("repeat with 2 ** 53", () => "ab".repeat(2 ** 53));
attempt("repeat of nothing with 2 ** 53", () => "".repeat(2 ** 53));
attempt("padStart to too large a length", () => "ab".padStart(2 ** 31));
attempt("padEnd to too large a length", () => "ab".padEnd(2 ** 32, "xy"));
attempt("padStart to too large a length with nothing to add", () => "ab".padStart(2 ** 31, ""));
attempt("afterwards everything still works", () => ["ab" + "ab", "ab".repeat(3), "ab".padStart(4)]);
