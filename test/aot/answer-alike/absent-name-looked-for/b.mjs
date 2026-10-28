// a.mjs with the field of the class called by the name that the text adds.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
class Failure extends Error { constructor() { super("x"); this.tag = 5; } }
new Failure();
console.log((0, eval)(decoded("'use strict'; try { Error.prototype.tag = 1; 'added' } catch (error) { error.name }")));
