// `new C(x)` at a site that alternates between two classes, so that its cache misses every time.
declare const console: any;
import { K1, K2, K3, byTurns, one } from "./untyped.js";
console.log(byTurns(K1, K2, 2_000_000), one(K3, 1000), typeof (K3 as any).prototype);
export {};
