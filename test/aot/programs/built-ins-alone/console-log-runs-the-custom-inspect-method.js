const probe = {
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
    return `custom ${typeof depth} ${typeof options} ${typeof inspect}`;
  },
};
console.log(probe);
console.log(Bun.inspect(probe));
