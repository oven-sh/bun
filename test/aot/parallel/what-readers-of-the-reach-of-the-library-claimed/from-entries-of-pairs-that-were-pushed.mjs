const key = Symbol.for("nodejs.util.inspect.custom");
const pairs = [];
pairs.push([key, () => "custom!"]);
console.log(Object.fromEntries(pairs));
