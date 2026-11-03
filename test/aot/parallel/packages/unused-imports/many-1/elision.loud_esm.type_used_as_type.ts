import { T } from "loud_esm";
const x: T = { a: 1 }; console.log(x.a);
console.log(JSON.stringify((globalThis as any).__loaded ?? null));
