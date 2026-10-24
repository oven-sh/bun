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

function lengths(names) {
  const seen = [];
  for (let i = 0; i < names.length; i++) {
    try {
      seen.push(names[i].length);
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  return seen;
}

function shouted(names) {
  return names.map(name => {
    try {
      return name.toUpperCase();
    } catch (error) {
      return error.constructor.name;
    }
  });
}

function joinedLength(names) {
  let total = 0;
  for (const name of names) total += name.length;
  return total;
}

function firstCodes(names) {
  const seen = [];
  for (const name of names) seen.push(typeof name === "string" ? name.charCodeAt(0) : typeof name);
  return seen;
}

function check(label, change) {
  const names = ["ada", "grace", "edsger"];
  let outcome = "";
  try {
    change(names);
  } catch (error) {
    outcome = " (the store threw " + error.constructor.name + ")";
  }
  console.log(label + outcome + " -> " + show(lengths(names)) + " " + show(shouted(names)) + " " + show(joinedLength(names.filter(name => name != null))) + " " + show(firstCodes(names)));
}

for (let i = 0; i < 2000; i++) {
  const names = ["ada", "grace", "edsger"];
  lengths(names);
  shouted(names);
  joinedLength(names);
  firstCodes(names);
}

const five = make("5");
const one = make("1");
const list = make("['l', 'i']");

check("nothing is changed", () => {});
check("a plain store", names => { names[1] = five; });
check("a store by a computed index", names => { names[one] = five; });
check("a store by a text index", names => { names["1"] = five; });
check("push", names => { names.push(five); });
check("push by apply", names => { names.push.apply(names, [five, list]); });
check("push by call", names => { Array.prototype.push.call(names, five); });
check("push of a spread", names => { names.push(...[five, null]); });
check("unshift", names => { names.unshift(five); });
check("splice", names => { names.splice(1, 1, five, list); });
check("fill", names => { names.fill(five, 1, 2); });
check("copyWithin after a push", names => { names.push(five); names.copyWithin(0, 3); });
check("Reflect.set", names => { Reflect.set(names, 1, five); });
check("Object.assign", names => { Object.assign(names, [five]); });
check("Object.assign from an object", names => { Object.assign(names, { 2: list }); });
check("defineProperty", names => { Object.defineProperty(names, 1, { value: five }); });
check("defineProperty with a getter", names => { Object.defineProperty(names, 1, { get: () => five }); });
check("a list pattern", names => { [names[0], names[2]] = [five, list]; });
check("an object pattern", names => { ({ a: names[1] } = { a: five }); });
check("a for-of head", names => { for (names[1] of [five]); });
check("a for-in head", names => { for (names[1] in { key: 1 }); });
check("an update", names => { names[1]++; });
check("a compound store", names => { names[1] += five; names[2] -= five; });
check("a logical store", names => { names[5] ??= five; });
check("a swap with a number", names => { let other = five; [names[0], other] = [other, names[0]]; });
check("delete", names => { delete names[1]; });
check("a longer length", names => { names.length = 5; });
check("a store past the end", names => { names[4] = "far"; });
check("reverse after a store", names => { names[0] = five; names.reverse(); });
check("sort after a store", names => { names[2] = five; names.sort(); });
check("with", names => { names.splice(0, 3, ...names.with(1, five)); });
check("an inherited element under a hole", names => { delete names[1]; Object.setPrototypeOf(names, Object.assign(Object.create(Array.prototype), { 1: five })); });
check("through an alias", names => { const alias = names; alias[1] = five; });
check("through a holder", names => { const holder = { names }; holder.names[1] = five; });
check("through a closure", names => { (() => { names[1] = five; })(); });
check("through arguments", names => { (function () { arguments[0][1] = five; })(names); });
check("through a callback of forEach", names => { names.forEach((name, index, all) => { if (index === 0) all[1] = five; }); });
check("through a callback of map", names => { names.map((name, index, all) => { all[2] = list; return name; }); });
check("through a comparator", names => { names.sort(() => { names[0] = five; return 0; }); });
check("through eval", names => { globalThis.namesForEval = names; (0, eval)("namesForEval[1] = 5"); delete globalThis.namesForEval; });
check("through new Function", names => { new Function("names", "names[1] = 5")(names); });
check("through a Proxy", names => { new Proxy(names, {})[1] = five; });
check("through a setter", names => { ({ set value(given) { names[1] = given; } }).value = five; });
check("through a conversion", names => { `${{ toString() { names[1] = five; return ""; } }}`; });
check("through JSON", names => { JSON.stringify({ toJSON() { names[1] = five; } }); });
check("through a generator", names => { const steps = (function* () { names[1] = yield; })(); steps.next(); steps.next(five); });
check("wrapped texts", names => { names[1] = new String("grace"); });
check("null and undefined", names => { names[0] = null; names[1] = undefined; });
check("frozen first", names => { Object.freeze(names); names[1] = five; });
