// The entry point imports two modules that import each other, of which the first throws behind the end of the second. A listener for uncaught exceptions then imports a module that imports the second: it does not run, and the import() rejects with the same error.
import "./handler.mjs";
import "./first.mjs";
console.log("main runs");
