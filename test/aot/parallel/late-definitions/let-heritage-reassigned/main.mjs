// A class is made late only where every class above it is one of the program that is evaluated once, or a built-in. Here what stands behind `extends` is something else, or changes before the first read.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, swap } from "./m.mjs";
swap();
say(() => new (read())().who());
