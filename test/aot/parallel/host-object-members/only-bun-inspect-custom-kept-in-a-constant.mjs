// The symbol is kept in a constant, and the method that lies under it is one of a class. The host calls it with util.inspect.
const key = Bun.inspect.custom;
class Point { constructor(x) { this.x = x; } [key](depth, options, inspect) { return "Point<" + inspect(this.x) + ">"; } }
console.log(new Point(3), [new Point("a")]);
