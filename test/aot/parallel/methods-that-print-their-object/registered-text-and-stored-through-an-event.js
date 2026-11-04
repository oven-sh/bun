const key = Symbol.for(process.env.KEY ?? ["nodejs", "util", "inspect", "custom"].join("."));
const event = new CustomEvent("x", { detail: (depth, options, inspect) => "registered text, through an event: " + inspect({ a: 1 }) });
const printed = {};
printed[key] = event.detail;
console.log(printed);
