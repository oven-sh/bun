// A method replaces a default that a spread of a frozen object brought, and is deleted before anybody reads it.
const DEFAULTS = Object.freeze({ retries: 3, timeout: 1000 });
const o = { ...DEFAULTS, timeout() { return 5; } };
delete o.timeout;
console.log(o.timeout ?? "default");
