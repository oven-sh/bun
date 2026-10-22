// TypeScript files that are CommonJS by the same signs as JavaScript files, required by JavaScript.
const whole = require("./whole"), names = require("./names"), typed = require("./typed"), es = require("./es");
console.log(whole.a, whole.kind, names.b, names.same, JSON.stringify(typed.make(7)));
console.log(es.stillEs);
