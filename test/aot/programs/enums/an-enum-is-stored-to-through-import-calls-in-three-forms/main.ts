import { read } from "./reader";
console.log(read());
((await import("./color")).Color as any).Green = 9;
console.log(read());
const { Color } = await import("./color");
(Color as any).Red = 8;
console.log(read());
import("./color").then(all => {
  (all as any).Color.Blue = 7;
  console.log(read());
});
