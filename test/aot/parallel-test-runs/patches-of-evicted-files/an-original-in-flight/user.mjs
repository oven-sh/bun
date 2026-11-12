import { top, topName, hit } from "./top.mjs";
import { low } from "./low.mjs";
console.log("SAID user runs"); export const user = () => [top(), topName, hit && hit(), low()].join();
