// `new` on classes two, three and four levels deep in untyped code: the `super(..)` calls are resolved statically.
// IR+ IsClassObjectUnmodified
// IR+ CreateThis v[0-9]+, v[0-9]+
// IR= 0 two ConstructSuper
// IR= 0 three ConstructSuper
// IR= 0 four ConstructSuper
// IR= 1 three = Construct v
// IR= 2 three IsClassObjectUnmodified
// IR= 3 four IsClassObjectUnmodified
declare const console: any;
import { two, three, four } from "./untyped.js";
console.log(two(400000), three(400000), four(400000));
export {};
