// `new Derived(..)` in untyped code calls the derived constructor directly, and `super(..)` does not go through the runtime.
// IR+ ^ .* = SuperConstruct 
// IR= 0 run SuperConstruct(?!.* isFallback)
// IR= 0 run NewArray
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
console.log((untyped as any).run(1_000_000));
export {};
