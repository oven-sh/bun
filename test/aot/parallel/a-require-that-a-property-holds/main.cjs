// The files that a require is asked for, which a property of a written object holds, are compiled, unless the property may hold something else.
const held = { load: require };
console.log(held.load("./held.cjs").name, typeof held.load);
const loaders = { load: require, other: 1 };
const load = name => loaders.load(name).name;
console.log(load("./late.cjs"), loaders.load("./late.cjs").name);
const changed = { load: require };
changed.load = name => ({ name: "not " + name });
console.log(changed.load("./replaced.cjs").name);
