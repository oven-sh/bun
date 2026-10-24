import { first } from "./first";
import { second } from "./second";
import { third } from "./third.js";

console.log(first().join(" "));
console.log((await second()).join(" "));
console.log(third().join(" "));
