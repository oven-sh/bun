const log = [];
const note = (text, value) => { log.push(text); return value; };
function flags(o) {
  return Reflect.ownKeys(o).map(k => { const d = Reflect.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + ("value" in d ? "=" + (typeof d.value === "function" ? "fn" : typeof d.value === "object" ? "object" : String(d.value)) : ""); }).join(" ");
}
function t(name, define) {
  let said;
  try {
    const C = define();
    said = typeof C === "function" ? "class " + flags(C) + " | prototype " + flags(C.prototype ?? {}) + " | instance " + (() => { try { return flags(new C()); } catch (e) { return "throws " + e.constructor.name; } })() : String(C);
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  console.log(name, "|", said, "|", log.join());
}
const key = text => text + (process.env.NOBODY_HAS_SET_THIS ?? "");
t("a method and then a getter of one name", () => class { m() { return 1; } get m() { return 2; } });
t("a getter and then a method of one name", () => class { get m() { return 2; } m() { return 1; } });
t("a getter, a method and a setter of one name", () => class { get m() { return 2; } m() { return 1; } set m(v) {} });
t("a setter, a getter, a setter of one name", () => class { set m(v) { log.push("first"); } get m() { return 2; } set m(v) { log.push("second"); } });
t("two methods of one name", () => { class K { m() { return 1; } n() {} m() { return 2; } } return [new K().m(), Object.getOwnPropertyNames(K.prototype).join()].join(" "); });
t("two static methods of one name", () => { class K { static m() { return 1; } static n() {} static m() { return 2; } } return [K.m(), Object.getOwnPropertyNames(K).join()].join(" "); });
t("a static method and then a static field of one name", () => class { static m() { return 1; } static m = 5; });
t("a static field and then a static method of one name", () => class { static m = 5; static m() { return 1; } });
t("a static getter and then a static field of one name", () => class { static get m() { return 1; } static m = 5; });
t("a field over a method", () => class { m() { return 1; } m = 5; });
t("a field over an accessor", () => class { get m() { return 1; } set m(v) { log.push("setter ran"); } m = 5; });
t("a field over an accessor of the base", () => { class B { get m() { return 1; } set m(v) { log.push("setter ran"); } } return class extends B { m = 5; }; });
t("two fields of one name", () => class { f = note("first", 1); g = 0; f = note("second", 2); });
t("two fields of one computed name", () => class { [key("f")] = note("first", 1); g = 0; [key("f")] = note("second", 2); });
t("number keys among fields", () => class { b = 1; 2 = 2; a = 3; 1 = 4; [key("0")] = 5; 1.5 = 6; [-1] = 7; 4294967295 = 8; 4294967294 = 9; });
t("symbol keys", () => class { [Symbol.iterator]() {} static [Symbol.hasInstance]() { return true; } get [Symbol.toStringTag]() { return "T"; } [Symbol.for("f")] = 1; a = 2; static [Symbol.for("s")] = 3; });
t("a static member with the computed name prototype", () => class { static [key("prototype")] = 1; });
t("a static member with the literal name prototype in brackets", () => class { static ["prototype"] = 1; });
t("a field with the computed name constructor", () => class { [key("constructor")] = 1; });
t("a field with the literal name constructor in brackets", () => class { ["constructor"] = 1; });
t("a static member called constructor", () => class { static constructor() { return 1; } static get constructor2() { return 2; } });
t("keys are computed in order, fields run later", () => class { [note("k1", "a")] = note("v1", 1); static [note("k2", "b")] = note("v2", 2); [note("k3", "c")]() {} static { note("block", 0); } static [note("k4", "d")] = note("v4", 4); });
t("the class name inside its own heritage", () => { try { return class K extends K {}; } catch (e) { return e.constructor.name; } });
t("the class name inside a computed key", () => { try { return class K { [K.name]() {} }; } catch (e) { return e.constructor.name; } });
t("the class name inside a static computed key", () => { try { return class K { static [K.name] = 1; }; } catch (e) { return e.constructor.name; } });
t("the class name is constant inside", () => { class K { static set() { K = 1; } } try { K.set(); return "stored"; } catch (e) { return e.constructor.name; } });
t("the class name can be stored to outside", () => { let K = class K { static get() { return K; } }; const first = K; K = 1; return first.get() === first; });
t("an anonymous class as a default", () => (({ D = class {} }) => D)({}));
t("an anonymous class in parentheses and a comma", () => { const N = (0, class {}); return N; });
t("an heir that never calls super", () => class extends Object { constructor() {} });
t("an heir that reads this before super", () => class extends Object { constructor() { this.a = 1; super(); } });
t("an heir that calls super in an arrow", () => class extends Object { a = 1; constructor() { const go = () => super(); go(); this.b = 2; } });
t("an heir that calls super in a finally", () => class extends Object { a = 1; constructor() { try { return; } finally { super(); } } });
t("a constructor that returns another object", () => class { a = 1; constructor() { return { other: true }; } });
t("an heir of a constructor that returns another object", () => { class B { constructor() { return { other: true }; } } return class extends B { a = 1; #p = 2; }; });
t("an heir of a constructor that returns a function", () => { class B { constructor() { return function made() {}; } } return class extends B { a = 1; }; });
t("an heir of a constructor that returns an array", () => { class B { constructor() { return [1, 2]; } } return class extends B { a = 1; 0 = "zero"; length = 5; }; });
t("an heir of a constructor that returns a proxy", () => { class B { constructor() { return new Proxy({}, { defineProperty(target, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(target, k, d); } }); } } return class extends B { a = 1; b = 2; }; });
t("an heir of a constructor that returns a frozen object", () => { class B { constructor() { return Object.freeze({}); } } return class extends B { a = 1; }; });
t("an heir of a constructor that returns the same object twice", () => { const one = {}; class B { constructor() { return one; } } class H extends B { #p = 1; a = 1; } new H(); try { new H(); return "stamped twice"; } catch (e) { return e.constructor.name + " " + flags(one); } });
t("extends DataView", () => class extends DataView { extra = 1; constructor() { super(new ArrayBuffer(4)); } });
t("arguments in a field initializer is an early error elsewhere, eval sees none", () => class { a = typeof globalThis.arguments; });
t("a getter named get and a static named static", () => class { get get() { return 1; } set set(v) {} static static() {} static get static2() { return 1; } async async() {} static async *[key("gen")]() {} });
t("fields named like keywords", () => class { static; get; set; async; await = 1; of = 2; let = 3; yield = 4; });
