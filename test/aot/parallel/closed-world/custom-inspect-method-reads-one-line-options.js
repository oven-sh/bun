// Where the formatter prints on one line, the options of a custom inspect method also hold breakLength and compact.
// The row of the options in src/codegen/builtins/host/runtime-dependencies.builtins.ts names neither: a test of the engine counts the fields of that row.
const custom = Symbol.for("nodejs.util.inspect.custom");
class Seen {
  [custom](depth, options, inspect) {
    const seen = { keys: Object.keys(options), breakLength: options.breakLength, compact: options.compact };
    return "Seen " + inspect({ seen, first: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", second: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, options);
  }
}
class Reads {
  [custom](depth, options) {
    return options.compact === true && options.breakLength === Infinity ? "one line" : "as printed alone";
  }
}
console.log(new Seen());
console.log(Bun.inspect(new Seen(), { compact: true }));
console.log(Bun.inspect.table([{ cell: new Seen() }]));
console.table([{ cell: new Reads() }, { cell: new URL("http://example.com/a?b=1") }]);
console.log(new Reads(), Bun.inspect(new Reads(), { compact: true }), Bun.inspect([new Reads()], { compact: false }));
