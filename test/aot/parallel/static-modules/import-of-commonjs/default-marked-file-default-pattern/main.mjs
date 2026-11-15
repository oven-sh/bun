// A marked CommonJS file stores `default` in the default of an assignment pattern that is never evaluated: the file has no `default` of its own, and the import is the object.
import skipped from "./skipped.cjs";
import taken from "./taken.cjs";
console.log(typeof skipped, skipped.c, taken);
