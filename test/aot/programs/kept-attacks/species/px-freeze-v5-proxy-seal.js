// Species: px freeze  proxy seal. It prints what plain Bun prints.
"use strict";
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body(); const p = new Proxy(b, {});
Object.seal(p);
b.hits = 2;
try { delete b.hits; } catch (error) { log.push(error.constructor.name); }
log.push(String(b.hits), String(Object.isSealed(b)));
console.log(log.join("; "));
