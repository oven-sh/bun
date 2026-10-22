// Object.freeze and Reflect.preventExtensions get a proxy without traps: the target is frozen, its field still reads what it held, and a store to it throws in strict code.
"use strict";
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body(); const p = new Proxy(b, {});
Object.freeze(p);
try { b.hits = 2; } catch (error) { log.push(error.constructor.name); }
log.push(String(b.hits), String(Object.isFrozen(b)));
const c = new Body(); Reflect.preventExtensions(new Proxy(c, {}));
try { c.extra = 1; } catch (error) { log.push(error.constructor.name); }
console.log(log.join("; "));
