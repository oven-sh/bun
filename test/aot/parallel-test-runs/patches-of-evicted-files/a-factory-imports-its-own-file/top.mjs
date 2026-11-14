import { lowName } from "./low.mjs";
console.log("SAID top runs"); export const topName = "top"; export const top = () => "top(" + lowName + ")"; let hits = 0; export const hit = () => ++hits;
