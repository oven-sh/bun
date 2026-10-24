// Species: px freeze  proxy. It prints what plain Bun prints.
"use strict";
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body(); const p = new Proxy(b, {});
Object.freeze(p);
try { b.hits = 2; } catch (error) { log.push(error.constructor.name); }
log.push(String(b.hits), String(Object.isFrozen(b)));
console.log(log.join("; "));
