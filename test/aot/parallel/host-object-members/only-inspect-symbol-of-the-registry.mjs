// The symbol is asked of the registry, and the method is called with a depth, the options and util.inspect.
console.log({ [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return "mine " + typeof depth + " " + typeof options + " " + typeof inspect; } });
