// A CommonJS file defines getters that return names of a second file, which looks at its own exports as a whole. A module calls one of the
// functions through the namespace of the first file; the function reads another name through `this`.
import * as outer from "./outer.cjs";

console.log(outer.readsAnother());
