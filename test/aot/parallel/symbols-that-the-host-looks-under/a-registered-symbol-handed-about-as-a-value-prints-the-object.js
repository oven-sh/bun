const shelf = { count: 1 };
const lay = (holder, key) => { holder[key] = () => "printed by the method"; };
lay(shelf, Symbol.for("nodejs.util.inspect.custom"));
console.log(shelf);
