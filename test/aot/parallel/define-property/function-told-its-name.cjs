// Object.defineProperty(f, "name", ..) on every kind of function, in every state of its name, and what stack traces and key lists say afterwards.
const captured = { n: 0 };
function frames(f, ...args) {
  try {
    f(...args);
  } catch (error) {
    return error.stack.split("\n").slice(1, 3).map(line => { const words = line.trim().split(" "); return words.length > 2 ? words.slice(1, -1).join(" ") : "(no name)"; }).join("|");
  }
  return "no error";
}
const kinds = {
  declaration: () => { function declared() { captured.n++; throw new Error("x"); } return declared; },
  expression: () => function () { captured.n++; throw new Error("x"); },
  named: () => function inner() { captured.n++; throw new Error("x"); },
  arrow: () => () => { captured.n++; throw new Error("x"); },
  free: () => function free() { throw new Error("x"); },
  method: () => ({ method() { captured.n++; throw new Error("x"); } }).method,
  getter: () => Object.getOwnPropertyDescriptor({ get got() { captured.n++; throw new Error("x"); } }, "got").get,
  computed: () => ({ ["com" + "puted"]() { captured.n++; throw new Error("x"); } }).computed,
  symbol: () => ({ [Symbol("sym")]: function () { captured.n++; throw new Error("x"); } }),
  bound: () => function target() { captured.n++; throw new Error("x"); }.bind(null),
  asynchronous: () => async function waits() { captured.n++; throw new Error("x"); },
  generator: () => function* yields() { captured.n++; throw new Error("x"); },
  constructor: () => { function Made() { this.n = captured.n++; throw new Error("x"); } Made.prototype.m = 1; return Made; },
  classPlain: () => class Plain { constructor() { throw new Error("x"); } },
  classWithStatic: () => class WithStatic { static field = 1; constructor() { throw new Error("x"); } },
  classNamedByStatic: () => class { static name = "own"; },
  classNamedByMethod: () => class { static name() {} },
  anonymousClass: () => class {},
};
const states = {
  fresh: f => f,
  read: f => (f.name, f),
  listed: f => (Object.getOwnPropertyNames(f), f),
  lengthRead: f => (f.length, f),
  withProperty: f => ((f.extra = 1), f),
  closed: f => Object.preventExtensions(f),
  frozen: f => Object.freeze(f),
  definedBefore: f => Object.defineProperty(f, "name", { value: "before", configurable: true }),
};
const definitions = {
  value: f => Object.defineProperty(f, "name", { value: "told" }),
  configurable: f => Object.defineProperty(f, "name", { value: "told", configurable: true }),
  restated: f => Object.defineProperty(f, "name", { value: f.name0 ?? "declared" }),
  empty: f => Object.defineProperty(f, "name", { value: "" }),
  built: f => Object.defineProperty(f, "name", { value: "to" + "ld".repeat(captured.n * 0 + 1) }),
  allStated: f => Object.defineProperty(f, "name", { value: "told", writable: false, enumerable: false, configurable: true }),
  writable: f => Object.defineProperty(f, "name", { value: "told", writable: true }),
  listed: f => Object.defineProperty(f, "name", { value: "told", enumerable: true }),
  fixed: f => Object.defineProperty(f, "name", { value: "told", configurable: false }),
  number: f => Object.defineProperty(f, "name", { value: 5 }),
  getter: f => Object.defineProperty(f, "name", { get: () => "got" }),
  handedIn: f => Object.defineProperty(f, "name", Object.assign({}, { value: "told" })),
  reflected: f => Reflect.defineProperty(f, "name", { value: "told" }),
};
for (const [kind, create] of Object.entries(kinds)) {
  for (const [state, prepare] of Object.entries(states)) {
    for (const [definition, define] of Object.entries(definitions)) {
      let f = create();
      if (typeof f !== "function") f = f[Object.getOwnPropertySymbols(f)[0]];
      const line = [kind, state, definition];
      try {
        prepare(f);
        define(f);
        line.push("defined");
      } catch (error) {
        line.push(error.constructor.name);
      }
      const d = Object.getOwnPropertyDescriptor(f, "name");
      line.push(d ? ("value" in d ? JSON.stringify(d.value) + (d.writable ? "W" : "w") : "getter") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c") : "none");
      line.push(Reflect.ownKeys(f).map(String).join(), String(f.name), Object.keys(f).join());
      if (!kind.startsWith("class") && !["anonymousClass", "asynchronous", "generator", "computed", "symbol", "bound"].includes(kind)) line.push(frames(f));
      else if (kind === "classPlain" || kind === "classWithStatic") line.push(frames(() => new f()));
      try {
        Object.defineProperty(f, "name", { value: "second" });
        line.push(f.name);
      } catch (error) {
        line.push(error.constructor.name);
      }
      line.push(String(delete f.name), String(f.name), Reflect.ownKeys(f).map(String).join());
      console.log(line.join(" ; "));
    }
  }
}
