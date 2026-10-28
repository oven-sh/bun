// Evaluated text changes the prototype of Error.prototype.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
console.log((0, eval)(decoded("'use strict'; try { Object.setPrototypeOf(Error.prototype, Object.create(Object.prototype)); 'changed' } catch (error) { error.name }")));
