"use strict";
Object.freeze(Object.prototype);
const E = {};
try { E.toString = 0; } catch (error) { console.log(error.constructor.name); }
console.log(typeof E.toString, Object.keys(E).length);
