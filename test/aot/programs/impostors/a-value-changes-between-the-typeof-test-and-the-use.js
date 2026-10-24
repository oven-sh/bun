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

function changedByACall() {
  let value = "text";
  const change = () => {
    value = 5;
  };
  if (typeof value === "string") {
    change();
    return [typeof value, value.length];
  }
  return "never";
}

function changedByAGetter(holder) {
  if (typeof holder.value === "string") return [typeof holder.value, holder.value.length];
  return "not a text at first";
}

function changedByAConversion(holder, other) {
  if (typeof holder.value === "string") {
    const label = "" + other;
    return [label, typeof holder.value, holder.value.length];
  }
  return "not a text at first";
}

function changedInALoop(values) {
  const seen = [];
  let current = values[0];
  for (let i = 0; i < values.length; i++) {
    if (typeof current === "string") seen.push(current.length);
    else seen.push(typeof current);
    current = values[i + 1];
  }
  return seen;
}

function changedThroughArguments(value) {
  if (typeof value === "string") {
    arguments[0] = [1, 2, 3, 4, 5, 6, 7];
    return [typeof value, value.length];
  }
  return "not a text";
}

function changedThroughAnAlias(holder, alias) {
  if (typeof holder.value === "string") {
    alias.value = { length: "from the alias" };
    return holder.value.length;
  }
  return "not a text";
}

function changedByAnElementGetter(list) {
  const seen = [];
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] === "string") seen.push(list[i].length);
  }
  return seen;
}

function* changedAcrossAYield() {
  let value = "text";
  const change = next => {
    value = next;
  };
  if (typeof value === "string") {
    yield change;
    yield [typeof value, value.length];
  }
}

async function changedAcrossAnAwait(holder, pause) {
  if (typeof holder.value === "string") {
    await pause;
    return [typeof holder.value, holder.value.length];
  }
  return "not a text";
}

for (let i = 0; i < 2000; i++) {
  changedByAGetter({ value: "text" });
  changedByAConversion({ value: "text" }, "x");
  changedInALoop(["a", "bc"]);
  changedThroughArguments("text");
  changedThroughAnAlias({ value: "text" }, {});
  changedByAnElementGetter(["a", "bc"]);
}

attempt("changed by a call", changedByACall);
attempt("changed by a getter", () => {
  let reads = 0;
  return changedByAGetter({ get value() { return [ "text", 5, [1, 2] ][reads++]; } });
});
attempt("changed by a conversion", () => {
  const holder = { value: "text" };
  return changedByAConversion(holder, { toString() { holder.value = [1, 2]; return "converted"; } });
});
attempt("changed in a loop", () => changedInALoop(["a", "bc", 5, ["x", "y", "z"], new String("wrapped"), "def", null, undefined, "g"]));
attempt("changed through arguments", () => changedThroughArguments("text"));
attempt("changed through an alias", () => {
  const holder = { value: "text" };
  return changedThroughAnAlias(holder, holder);
});
attempt("not changed through another object", () => changedThroughAnAlias({ value: "text" }, {}));
attempt("changed by an element getter", () => {
  let reads = 0;
  const list = ["a"];
  Object.defineProperty(list, 1, { get() { return reads++ % 2 ? { length: "second read" } : "first read"; } });
  return changedByAnElementGetter(list);
});
attempt("changed across a yield", () => {
  const steps = changedAcrossAYield();
  steps.next().value([1, 2, 3]);
  return steps.next().value;
});
const holder = { value: "text" };
const pending = changedAcrossAnAwait(holder, Promise.resolve());
holder.value = [1, 2, 3];
pending.then(result => {
  attempt("changed across an await", () => result);
  return changedAcrossAnAwait({ value: "text" }, null);
}).then(result => attempt("not changed across an await", () => result));
