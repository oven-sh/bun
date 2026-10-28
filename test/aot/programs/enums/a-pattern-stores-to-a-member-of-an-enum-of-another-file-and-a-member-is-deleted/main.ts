import { Color } from "./color";
[(Color as any).Green] = [5];
console.log(Color.Green, delete (Color as any).Red, Color.Red);
