// A class, a function without captures and a regular expression that a variable of a file holds are made at the first read of the variable.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
say(() => [read().source, read().flags, read().lastIndex, read() === read()].join());
