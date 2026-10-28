// One declaration of each pair is gone when the program runs, so each name is declared once.
import { OnlyAType, Alias } from "./other";
// @ts-ignore
import type { value } from "./other";
// @ts-ignore
import { described } from "./other";
// @ts-ignore
import { overloaded } from "./other";
const OnlyAType = "mine";
function Alias() {
  return "mine";
}
const value = "mine";
declare const described: string;
declare function overloaded(): string;
const typed: OnlyAType = { a: 1 };
console.log(OnlyAType, Alias(), value, described, overloaded(), typed.a);
