// `new Derived(..)` in untyped code: the derived constructor is called directly and `super(..)` enters the parent without the run time.
// IR+ ConstructSuper
// IR= 0 run SuperConstruct
// IR= 0 run NewArray
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
console.log((untyped as any).run(1_000_000));
export {};
