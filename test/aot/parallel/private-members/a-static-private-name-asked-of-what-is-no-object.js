// `#name in value` is not quoted in the message, whether the name is static or of an instance; `"x" in value` beside it is.
class C {
  static #field = 1;
  #instance = 1;
  static hasField(v) { return #field in v; }
  static hasInstance(v) { return #instance in v; }
  static hasName(v) { return "x" in v; }
  static hasEither(v, w) { return ("x" in w) || (#field in v); }
}
for (const ask of [() => C.hasField(1), () => C.hasField("s"), () => C.hasField(null), () => C.hasInstance(1), () => C.hasName(1), () => C.hasEither(1, {}), () => C.hasEither({}, 2), () => C.hasField(C)]) {
  try { console.log(ask()); } catch (error) { console.log(error.message); }
}
