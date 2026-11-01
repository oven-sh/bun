// What is made late is one object, with the name, the length, the state and the properties of one that was made where it stands.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
read().prototype.m = function () { return this.x + 1; };
say(() => [new (read())().m(), read().prototype.constructor === read()].join());
