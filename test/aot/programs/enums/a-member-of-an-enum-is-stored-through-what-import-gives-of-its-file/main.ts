import { Color } from "./color";
const later = await import("./color");
(later as any).Color.Green = 4;
console.log(Color.Green);
