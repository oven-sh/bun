import { Color } from "./barrel";
import * as all from "./star";
import { Color as Starred } from "./star";
console.log(Color.Green, Color["Blue"], Starred.Red, all.Color.Green + 1, all["Color"]["Blue"] + "!");
if (Color.Green === 1) console.log("one");
else console.log("other");
