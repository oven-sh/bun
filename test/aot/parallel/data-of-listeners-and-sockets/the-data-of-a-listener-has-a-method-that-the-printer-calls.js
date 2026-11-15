// The object that comes back has the method that the printer of objects looks for, under the symbol that the program has asked for itself.
const custom = Symbol.for("nodejs.util.inspect.custom");
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data() {} },
  data: {
    [custom](depth, options, inspect) {
      return "printed by my own method " + typeof depth + " " + typeof options + " " + typeof inspect;
    },
  },
});
console.log(listener.data);
listener.stop(true);
