const custom = Symbol.for("nodejs.util.inspect.custom");
class P { [custom](depth, options) { return "custom " + typeof depth + typeof options; } }
console.log(new P()); console.error(new P());
