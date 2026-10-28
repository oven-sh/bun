import Whole, { Paint } from "./color";
import { read } from "./reader";
console.log(read(), Whole.Green, Paint.Green);
(Whole as any).Green = 9;
console.log(read(), Whole.Green, Paint.Green);
(Paint as any).Red = 8;
console.log(read(), Whole.Red, Paint.Red);
