// A build can follow an object from the `new` that made it. Many objects have no such place: the error that the engine throws, the result of
// an iterator's step, the list that a match answers, `arguments`, the strings of a template, what a rest parameter gathers, the promise of
// an async function, the headers of a response. Each of them still leads to its class and to its prototype object.
// The scenes are those of ./two-roads: a member of a class, of its prototype object or of one of its functions is changed
// through such an instance and read by the name.
import type { Random } from "./random";
import { generateWith } from "./two-roads";

export const generate = (random: Random, typed: boolean) => generateWith(random, typed, { road: "an instance that is handed out" });
