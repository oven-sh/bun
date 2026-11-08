// The symbol itself is handed in and read back, and a method is laid under what came back.
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, data: Symbol.for("nodejs.util.inspect.custom") });
const key = listener.data;
console.log({
  [key]() {
    return "printed by my own method";
  },
});
listener.stop(true);
