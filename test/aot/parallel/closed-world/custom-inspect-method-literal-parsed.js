// Custom inspect method of a literal behind parsed values.
const custom = Symbol.for("nodejs.util.inspect.custom");
const holder = JSON.parse(process.env.TEXT ?? '{"a":1}');
holder.inner = { [custom](depth, options, inspect) { return "literal " + typeof depth + " " + typeof options.stylize + " " + typeof inspect; } };
console.log(holder);
