// Evaluated text replaces a member of Bun that the program never reads.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
console.log((0, eval)(decoded("'use strict'; try { Bun.nanoseconds = () => 7; 'replaced' } catch (error) { error.name }")));
