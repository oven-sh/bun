const shelf = { count: 0 };
Object.defineProperty(shelf, Symbol.for("nodejs.util.inspect.custom"), { value: () => "printed by the method" });
console.log(shelf);
