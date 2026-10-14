// `new` on a function or a class of untyped code that is known: CreateThis and a direct call, which is inlined like any other.
// IR= 0 makesPoints Construct
// IR= 1 makesPoints CreateThis
// IR= 1 makesPoints CallDirect
// IR= 0 makesBases Construct
// IR= 1 makesBases CreateThis
// IR= 0 makesFields Construct
// IR= 1 makesFields CreateThis
// IR= 0 makesLarge Construct
// IR= 2 makesLarge CallDirect
// IR= 0 makesEither Construct
// IR= 1 makesEither IsObject
// IR= 1 makesGiven Construct
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.makesPoints(1_000_000), m.makesBases(1_000_000), m.makesFields(1_000_000), m.makesLarge(100_000), m.makesEither(1_000_000), m.makesGiven(m.Point, 1_000_000));
export {};
