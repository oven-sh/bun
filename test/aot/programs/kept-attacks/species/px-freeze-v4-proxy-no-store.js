// Species: px freeze  proxy no store. It prints what plain Bun prints.
"use strict";
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body(); const p = new Proxy(b, {});
Object.freeze(p);
log.push(String(b.hits), String(Object.isFrozen(b)));
console.log(log.join("; "));
