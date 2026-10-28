// The entry point imports two modules. The first imports a CommonJS file that calls import() on the second and drainMicrotasks() of bun:jsc, and a file that throws; the second imports another file that throws. Both files run inside the drain, in the order in which the loader has asked for them, and the error of the first of them ends the program.
import "./lines.cjs";
import "./first.mjs";
import "./second.mjs";
lines.push("main runs");
