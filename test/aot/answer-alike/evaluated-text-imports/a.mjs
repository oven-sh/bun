// Evaluated text imports a built-in module that the program imports too.
import "node:path";
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const never = process.argv.length > 99;
let answer;
try { answer = typeof (await new Function(decoded("return import('node:path')"))()).join; } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 23); }
console.log(answer);
