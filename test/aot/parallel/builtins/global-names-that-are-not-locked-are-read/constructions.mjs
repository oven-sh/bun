// Other classes lie under two names. `bun run` leaves a construction out where nothing takes the object, and constructs where a variable does.
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
