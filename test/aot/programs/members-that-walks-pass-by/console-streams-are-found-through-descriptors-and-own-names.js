// The functions that list every own name, and those that answer descriptors, come by what is not enumerable.
const one = Object.getOwnPropertyDescriptor(console, "_stdout");
console.log(one.enumerable, one.configurable, (one.value ?? one.get.call(console)) === process.stdout);

const all = Object.getOwnPropertyDescriptors(console);
console.log(all._stderr.enumerable, (all._stderr.value ?? all._stderr.get.call(console)) === process.stderr);

const names = Object.getOwnPropertyNames(console).filter(name => name.startsWith("_std")).sort();
console.log(names.join(" "), names.map(name => console[name] === process[name.slice(1)]).join(" "));

const keys = Reflect.ownKeys(console).filter(name => typeof name === "string" && name.startsWith("_std")).sort();
console.log(keys.map(name => typeof console[name].write).join(" "));

const copy = Object.defineProperties({}, all);
console.log(copy._stdout === process.stdout, Object.keys(copy).includes("_stdout"));
