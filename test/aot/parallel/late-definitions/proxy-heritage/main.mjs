// A class is made late only where every class above it is one of the program that is evaluated once, or a built-in. Here what stands behind `extends` is something else, or changes before the first read.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
console.log("main runs");
say(() => new (read())().who());
