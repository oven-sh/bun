const table = {};
const key = Symbol.for(JSON.parse("\"nodejs.util.inspect.custom\""));
table[key] = () => "printed by its own method";
Promise.resolve(1).then(value => console.log(value + 1));
console.log(table);
