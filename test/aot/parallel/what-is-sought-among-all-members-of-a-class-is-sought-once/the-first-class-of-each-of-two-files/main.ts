declare const console: { log(...values: unknown[]): void };
const show = (o: any) => Object.keys(o).sort().map(k => k + "=" + String(o[k])).join(",");
import { Other } from "./other.ts";
class Mine { m; constructor() { this.m = 1; } }
console.log(show(new Mine()), show(new Other()));
