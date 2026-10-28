// `new` on classes two, three and four levels deep in untyped code: the `super(..)` calls are resolved statically.
// IR= 0 two (SuperConstruct|ConstructSuperForwardVarargs)(?!.* isFallback)
// IR= 0 three (SuperConstruct|ConstructSuperForwardVarargs)(?!.* isFallback)
// IR= 0 four (SuperConstruct|ConstructSuperForwardVarargs)(?!.* isFallback)
// IR= 0 two  = Construct v[0-9]+ \(.*\)(?!.* isFallback)
// IR= 0 three  = Construct v[0-9]+ \(.*\)(?!.* isFallback)
// IR= 0 four  = Construct v[0-9]+ \(.*\)(?!.* isFallback)
declare const console: any;
import { two, three, four } from "./untyped.js";
console.log(two(400000), three(400000), four(400000));
export {};
