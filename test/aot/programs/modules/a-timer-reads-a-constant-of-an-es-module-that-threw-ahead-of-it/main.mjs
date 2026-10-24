// A timer reads a constant of an es module that threw ahead of it.
import "./first.mjs";
import { k } from "./a.mjs";
console.log("not reached", k);
