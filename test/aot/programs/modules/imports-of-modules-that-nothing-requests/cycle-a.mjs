import { b } from "./cycle-b.mjs";
import { two } from "./leaf-two.cjs";
ran.push("cycle-a");
export const a = () => "a+" + b() + "+" + two;
export const name = "a";
