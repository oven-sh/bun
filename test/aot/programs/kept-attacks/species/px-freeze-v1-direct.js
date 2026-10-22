// Species: px freeze  direct. It prints what plain Bun prints.
"use strict";
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body();
Object.freeze(b);
try { b.hits = 2; } catch (error) { log.push(error.constructor.name); }
log.push(String(b.hits), String(Object.isFrozen(b)));
console.log(log.join("; "));
