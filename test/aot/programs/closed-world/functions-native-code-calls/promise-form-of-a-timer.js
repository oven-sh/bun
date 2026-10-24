// The getter of a timer under Symbol.for("nodejs.util.promisify.custom") requires node:timers/promises. Whatever runs the getter has the module in the executable.
const key = Symbol.for("nodejs.util.promisify.custom");
const lines = [];
const copied = { ...setTimeout };
lines.push("spread " + typeof copied[key] + " " + copied[key].name);
const assigned = Object.assign({}, setInterval);
lines.push("assign " + typeof assigned[key] + " " + assigned[key].name);
const named = Object.getOwnPropertySymbols(setImmediate)[0];
lines.push("own symbol " + String(named === key) + " " + setImmediate[named].name);
const descriptor = Object.getOwnPropertyDescriptor(setTimeout, key);
lines.push("descriptor " + typeof descriptor.get + " " + descriptor.enumerable + " " + descriptor.configurable + " " + (descriptor.get.call(undefined) === copied[key]));
lines.push("reflect " + (Reflect.get(setTimeout, key) === copied[key]));
copied[key](1, "slept").then(value => {
  lines.push(value);
  console.log(lines.join("\n"));
});
