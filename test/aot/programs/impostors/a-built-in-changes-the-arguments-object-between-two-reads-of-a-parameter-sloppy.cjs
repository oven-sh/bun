const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

function store(list, index, value) {
  list[index] = value;
}

function g1(p, q) {
  const before = [p, arguments[0]];
  void (arguments[0] = "changed");
  return [before, p, q, arguments[0], arguments.length];
}

function g2(p, q) {
  const before = [p, arguments[0]];
  void (arguments["0"] = "changed");
  return [before, p, q, arguments[0], arguments.length];
}

function g3(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.reverse.call(arguments));
  return [before, p, q, arguments[0], arguments.length];
}

function g4(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.fill.call(arguments, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g5(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.sort.call(arguments));
  return [before, p, q, arguments[0], arguments.length];
}

function g6(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.shift.call(arguments));
  return [before, p, q, arguments[0], arguments.length];
}

function g7(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.unshift.call(arguments, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g8(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.splice.call(arguments, 0, 1, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g9(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.copyWithin.call(arguments, 0, 1));
  return [before, p, q, arguments[0], arguments.length];
}

function g10(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.pop.call(arguments));
  return [before, p, q, arguments[0], arguments.length];
}

function g11(p, q) {
  const before = [p, arguments[0]];
  void (Object.assign(arguments, ["changed"]));
  return [before, p, q, arguments[0], arguments.length];
}

function g12(p, q) {
  const before = [p, arguments[0]];
  void (Reflect.set(arguments, 0, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g13(p, q) {
  const before = [p, arguments[0]];
  void (Reflect.set(arguments, "0", "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g14(p, q) {
  const before = [p, arguments[0]];
  void (Object.defineProperty(arguments, 0, { value: "changed" }));
  return [before, p, q, arguments[0], arguments.length];
}

function g15(p, q) {
  const before = [p, arguments[0]];
  void (Object.defineProperty(arguments, 0, { value: "changed", writable: false }), arguments[0] = "again");
  return [before, p, q, arguments[0], arguments.length];
}

function g16(p, q) {
  const before = [p, arguments[0]];
  void (Object.defineProperty(arguments, 0, { get: () => "got" }));
  return [before, p, q, arguments[0], arguments.length];
}

function g17(p, q) {
  const before = [p, arguments[0]];
  void (delete arguments[0], arguments[0] = "changed");
  return [before, p, q, arguments[0], arguments.length];
}

function g18(p, q) {
  const before = [p, arguments[0]];
  void (Reflect.deleteProperty(arguments, 0), Reflect.set(arguments, 0, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g19(p, q) {
  const before = [p, arguments[0]];
  void (Object.freeze(arguments), p = "the parameter alone");
  return [before, p, q, arguments[0], arguments.length];
}

function g20(p, q) {
  const before = [p, arguments[0]];
  void (new Proxy(arguments, {})[0] = "changed");
  return [before, p, q, arguments[0], arguments.length];
}

function g21(p, q) {
  const before = [p, arguments[0]];
  void (store(arguments, 0, "changed"));
  return [before, p, q, arguments[0], arguments.length];
}

function g22(p, q) {
  const before = [p, arguments[0]];
  void ([arguments].forEach(list => { list[0] = "changed"; }));
  return [before, p, q, arguments[0], arguments.length];
}

function g23(p, q) {
  const before = [p, arguments[0]];
  void (arguments.length = 0, arguments[0] = "changed");
  return [before, p, q, arguments[0], arguments.length];
}

function g24(p, q) {
  const before = [p, arguments[0]];
  void (p = "the parameter");
  return [before, p, q, arguments[0], arguments.length];
}

function g25(p, q) {
  const before = [p, arguments[0]];
  void ([p] = ["destructured"]);
  return [before, p, q, arguments[0], arguments.length];
}

function g26(p, q) {
  const before = [p, arguments[0]];
  void (Array.from(arguments).reverse());
  return [before, p, q, arguments[0], arguments.length];
}

function g27(p, q) {
  const before = [p, arguments[0]];
  void ([...arguments].fill("of the copy"));
  return [before, p, q, arguments[0], arguments.length];
}

function g28(p, q) {
  const before = [p, arguments[0]];
  void (Array.prototype.slice.call(arguments).reverse());
  return [before, p, q, arguments[0], arguments.length];
}

console.log("strict:", (function () { return this === undefined; })());
attempt("arguments[0] = \"changed\"", () => g1("same", "other"));
attempt("arguments[0] = \"changed\", one argument", () => g1("same"));
attempt("arguments[\"0\"] = \"changed\"", () => g2("same", "other"));
attempt("arguments[\"0\"] = \"changed\", one argument", () => g2("same"));
attempt("Array.prototype.reverse.call(arguments)", () => g3("same", "other"));
attempt("Array.prototype.reverse.call(arguments), one argument", () => g3("same"));
attempt("Array.prototype.fill.call(arguments, \"changed\")", () => g4("same", "other"));
attempt("Array.prototype.fill.call(arguments, \"changed\"), one argument", () => g4("same"));
attempt("Array.prototype.sort.call(arguments)", () => g5("same", "other"));
attempt("Array.prototype.sort.call(arguments), one argument", () => g5("same"));
attempt("Array.prototype.shift.call(arguments)", () => g6("same", "other"));
attempt("Array.prototype.shift.call(arguments), one argument", () => g6("same"));
attempt("Array.prototype.unshift.call(arguments, \"changed\")", () => g7("same", "other"));
attempt("Array.prototype.unshift.call(arguments, \"changed\"), one argument", () => g7("same"));
attempt("Array.prototype.splice.call(arguments, 0, 1, \"changed\")", () => g8("same", "other"));
attempt("Array.prototype.splice.call(arguments, 0, 1, \"changed\"), one argument", () => g8("same"));
attempt("Array.prototype.copyWithin.call(arguments, 0, 1)", () => g9("same", "other"));
attempt("Array.prototype.copyWithin.call(arguments, 0, 1), one argument", () => g9("same"));
attempt("Array.prototype.pop.call(arguments)", () => g10("same", "other"));
attempt("Array.prototype.pop.call(arguments), one argument", () => g10("same"));
attempt("Object.assign(arguments, [\"changed\"])", () => g11("same", "other"));
attempt("Object.assign(arguments, [\"changed\"]), one argument", () => g11("same"));
attempt("Reflect.set(arguments, 0, \"changed\")", () => g12("same", "other"));
attempt("Reflect.set(arguments, 0, \"changed\"), one argument", () => g12("same"));
attempt("Reflect.set(arguments, \"0\", \"changed\")", () => g13("same", "other"));
attempt("Reflect.set(arguments, \"0\", \"changed\"), one argument", () => g13("same"));
attempt("Object.defineProperty(arguments, 0, { value: \"changed\" })", () => g14("same", "other"));
attempt("Object.defineProperty(arguments, 0, { value: \"changed\" }), one argument", () => g14("same"));
attempt("Object.defineProperty(arguments, 0, { value: \"changed\", writable: false }), arguments[0] = \"again\"", () => g15("same", "other"));
attempt("Object.defineProperty(arguments, 0, { value: \"changed\", writable: false }), arguments[0] = \"again\", one argument", () => g15("same"));
attempt("Object.defineProperty(arguments, 0, { get: () => \"got\" })", () => g16("same", "other"));
attempt("Object.defineProperty(arguments, 0, { get: () => \"got\" }), one argument", () => g16("same"));
attempt("delete arguments[0], arguments[0] = \"changed\"", () => g17("same", "other"));
attempt("delete arguments[0], arguments[0] = \"changed\", one argument", () => g17("same"));
attempt("Reflect.deleteProperty(arguments, 0), Reflect.set(arguments, 0, \"changed\")", () => g18("same", "other"));
attempt("Reflect.deleteProperty(arguments, 0), Reflect.set(arguments, 0, \"changed\"), one argument", () => g18("same"));
attempt("Object.freeze(arguments), p = \"the parameter alone\"", () => g19("same", "other"));
attempt("Object.freeze(arguments), p = \"the parameter alone\", one argument", () => g19("same"));
attempt("new Proxy(arguments, {})[0] = \"changed\"", () => g20("same", "other"));
attempt("new Proxy(arguments, {})[0] = \"changed\", one argument", () => g20("same"));
attempt("store(arguments, 0, \"changed\")", () => g21("same", "other"));
attempt("store(arguments, 0, \"changed\"), one argument", () => g21("same"));
attempt("[arguments].forEach(list => { list[0] = \"changed\"; })", () => g22("same", "other"));
attempt("[arguments].forEach(list => { list[0] = \"changed\"; }), one argument", () => g22("same"));
attempt("arguments.length = 0, arguments[0] = \"changed\"", () => g23("same", "other"));
attempt("arguments.length = 0, arguments[0] = \"changed\", one argument", () => g23("same"));
attempt("p = \"the parameter\"", () => g24("same", "other"));
attempt("p = \"the parameter\", one argument", () => g24("same"));
attempt("[p] = [\"destructured\"]", () => g25("same", "other"));
attempt("[p] = [\"destructured\"], one argument", () => g25("same"));
attempt("Array.from(arguments).reverse()", () => g26("same", "other"));
attempt("Array.from(arguments).reverse(), one argument", () => g26("same"));
attempt("[...arguments].fill(\"of the copy\")", () => g27("same", "other"));
attempt("[...arguments].fill(\"of the copy\"), one argument", () => g27("same"));
attempt("Array.prototype.slice.call(arguments).reverse()", () => g28("same", "other"));
attempt("Array.prototype.slice.call(arguments).reverse(), one argument", () => g28("same"));
