// A class and a function of another file: every call is copied, so their entries by value are closed; the files' own bodies are started by the run time and keep their entries.
import { Square, twice } from "./shapes.mjs";
let sum = 0;
for (let i = 0; i < 5; i++) sum += new Square(i).area() + twice(i);
console.log(sum);
