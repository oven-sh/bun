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

const log = [];
globalThis.log = log;

function replace(text, pattern, replacement) {
  return text.replace(pattern, replacement);
}

function replaceAll(text, pattern, replacement) {
  return text.replaceAll(pattern, replacement);
}

function split(text, separator, limit) {
  return text.split(separator, limit);
}

function match(text, pattern) {
  return text.match(pattern);
}

function matchAll(text, pattern) {
  return text.matchAll(pattern);
}

function search(text, pattern) {
  return text.search(pattern);
}

function report(label, run) {
  attempt(label, run);
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

for (let i = 0; i < 2000; i++) {
  replace("a-b", "-", "+");
  replaceAll("a-b-c", "-", "+");
  split("a-b", "-");
  match("a-b", "-");
  search("a-b", "-");
}

function standIn(symbol, name) {
  return {
    [symbol](...given) {
      log.push(name + " got " + given.map(value => typeof value + " " + String(value)).join(" | ") + " this is the object: " + (this === standIns[name]));
      return name + " answered";
    },
    toString() {
      log.push(name + " toString");
      return "-";
    },
  };
}

const standIns = {
  replace: standIn(Symbol.replace, "replace"),
  split: standIn(Symbol.split, "split"),
  match: standIn(Symbol.match, "match"),
  matchAll: standIn(Symbol.matchAll, "matchAll"),
  search: standIn(Symbol.search, "search"),
};

report("replace", () => replace("a-b", standIns.replace, "+"));
report("replaceAll uses Symbol.replace", () => replaceAll("a-b", standIns.replace, "+"));
report("split", () => split("a-b", standIns.split, 5));
report("split without a limit", () => split("a-b", standIns.split));
report("match", () => match("a-b", standIns.match));
report("matchAll", () => matchAll("a-b", standIns.matchAll));
report("search", () => search("a-b", standIns.search));
report("the wrong stand-in is turned into a text: replace", () => replace("a-b", standIns.split, "+"));
report("the wrong stand-in is turned into a text: split", () => split("a-b", standIns.replace));
report("the wrong stand-in is turned into a pattern: match", () => match("a-b", standIns.replace));
report("the wrong stand-in is turned into a pattern: search", () => search("a-b", standIns.replace));
report("the receiver is passed as it is", () => String.prototype.replace.call(5, standIns.replace, "+"));
report("a wrapped receiver is passed as it is", () => replace(new String("a-b"), { [Symbol.replace]: given => typeof given }, "+"));

report("a stand-in whose method is undefined", () => replace("a-b", { [Symbol.replace]: undefined, toString: () => "-" }, "+"));
report("a stand-in whose method is null", () => split("a-b", { [Symbol.split]: null, toString: () => "-" }));
report("a stand-in whose method is not callable", () => replace("a-b", { [Symbol.replace]: 5, toString: () => "-" }, "+"));
report("a stand-in whose method is a getter", () => replace("a-b", { get [Symbol.replace]() { log.push("get Symbol.replace"); return () => "from the getter"; } }, "+"));
report("a stand-in that throws", () => split("a-b", { [Symbol.split]() { throw new RangeError("no"); } }));
report("a stand-in that returns an object", () => typeof match("a-b", { [Symbol.match]: () => ({}) }));
report("a stand-in that is a function", () => replace("a-b", Object.assign(() => {}, { [Symbol.replace]: () => "a function answered" }), "+"));
report("a stand-in that is a list", () => split("a-b", Object.assign(["-"], { [Symbol.split]: () => "a list answered" })));
report("a stand-in that is a Proxy", () => replace("a-b", new Proxy({}, { get(target, key) { log.push("get " + String(key)); return key === Symbol.replace ? () => "a proxy answered" : undefined; } }), "+"));
report("replaceAll asks a stand-in that says it is a pattern for its flags", () => replaceAll("a-b", { [Symbol.match]: true, get flags() { log.push("get flags"); return "g"; }, [Symbol.replace]: () => "answered" }, "+"));
report("replaceAll refuses one without the g flag", () => replaceAll("a-b", { [Symbol.match]: true, flags: "", [Symbol.replace]: () => "answered" }, "+"));
report("matchAll refuses one without the g flag", () => matchAll("a-b", { [Symbol.match]: true, flags: "i", [Symbol.matchAll]: () => "answered" }));
report("null as a pattern", () => [replace("a null b", null, "+"), split("a null b", null), search("a null b", null)]);
report("undefined as a pattern", () => [replace("a undefined b", undefined, "+"), split("a undefined b", undefined), search("a undefined b", undefined), match("ab", undefined).length]);

const subclassLog = [];
class Loud extends RegExp {
  [Symbol.replace](text, replacement) {
    subclassLog.push("replace");
    return "loud " + super[Symbol.replace](text, replacement);
  }
  [Symbol.split](text, limit) {
    subclassLog.push("split");
    return ["loud", ...super[Symbol.split](text, limit)];
  }
  exec(text) {
    subclassLog.push("exec");
    return super.exec(text);
  }
}
report("a subclass of RegExp: replace", () => [replace("a-b", new Loud("-"), "+"), subclassLog.splice(0)]);
report("a subclass of RegExp: split", () => [split("a-b", new Loud("-")), subclassLog.splice(0).length > 0]);
report("a subclass of RegExp: match", () => [match("a-b", new Loud("-"))[0], subclassLog.splice(0)]);
report("a subclass of RegExp: search", () => [search("a-b", new Loud("-")), subclassLog.splice(0)]);
report("a pattern with an exec of its own", () => replace("a-b", Object.assign(/-/, { exec() { log.push("own exec"); return null; } }), "+"));
report("honest again", () => [replace("a-b", "-", "+"), replaceAll("a-b-c", "-", "+"), split("a-b", "-"), match("a-b", "-")[0], search("a-b", "-")]);
