// An ES module imports a CommonJS file that calls import() and drainMicrotasks() of bun:jsc and then throws. Inside the drain the next file requires a module that imports the first file: nobody hears of the error, and the import() settles.
import "./lines.cjs";
import "./waits.mjs";
import "./throws.cjs";
import "./requires.cjs";
lines.push("main");
