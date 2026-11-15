// The variable is exported behind the form, under another name: another file changes the object.
import { kind, Signs } from "./marks.js";
console.log(kind(-1), kind(7), kind(5));
for (let i = 0; i < 3000; i++) kind(i & 7);
Signs.Middle = 5;
console.log(kind(-1), kind(7), kind(5));
