// `require()` of the program's own ES modules, for their default exports.
declare const require: (specifier: string) => any
const named = require("./req/named.js").default
const literal = (require("./req/literal.js") as typeof import("./req/literal.js")).default
const fn = require("./req/fn.js").default
const whole = require("./req/named.js")
console.log(named?.name, literal?.name, typeof fn, fn?.(), Object.keys(whole).sort().join(), whole.other, whole.default === named)
function table() { return [named, literal, fn].map(x => typeof x).join() }
console.log(table())
