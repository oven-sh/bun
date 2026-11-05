// Reference: bun build --compile
// Other classes lie under two names. `bun build --compile` constructs each time. `bun run` leaves a construction out where nothing takes the object.
const made = [];
globalThis.WeakMap = class { constructor() { made.push("WeakMap"); } };
globalThis.Date = class { constructor(...given) { made.push("Date " + given.length); } };
const first = new WeakMap();
new WeakMap();
const second = new Date();
new Date();
const third = new Date(0);
new Date(0);
console.log(made.join(", "));
