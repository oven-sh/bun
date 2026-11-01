import { first } from "./main";
console.log("gauge.ts runs", first);
export interface Gauge {
  level: number;
}
