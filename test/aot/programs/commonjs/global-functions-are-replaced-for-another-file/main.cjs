// Global functions are replaced for another file.
const a = require("./a.cjs");
console.log(a.now(), a.parse(), a.enc());
const realNow = Date.now;
Date.now = () => 42;
globalThis.parseInt = () => "replaced parseInt";
globalThis.encodeURIComponent = () => "replaced encode";
console.log(a.now(), a.parse(), a.enc());
Date.now = realNow;
globalThis.Date = class { static now() { return "other Date"; } };
console.log(a.now());
