// JavaScript that imports a TypeScript enum and stores to a member reads back what it stored.
import { E } from "./a.ts";
E.A = 9;
console.log(E.A);
