// Evaluated text adds a name to Error.prototype. A class of the program stores a field of another name below it.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
class Failure extends Error { constructor() { super("x"); this.label = 5; } }
new Failure();
console.log((0, eval)(decoded("'use strict'; try { Error.prototype.tag = 1; 'added' } catch (error) { error.name }")));
