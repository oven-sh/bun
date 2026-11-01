// m.mjs has begun and not finished while what it imports runs. watcher.mjs answers to a name and reads the bindings of m.mjs. Loaded then, under a name that the build
// does not know, it finds them in their dead zone; loaded in a job, it finds their values.
// Entry points: ./watcher.mjs
import { f, s, C } from "./m.mjs";
console.log("main:", typeof f, typeof s, typeof C);
