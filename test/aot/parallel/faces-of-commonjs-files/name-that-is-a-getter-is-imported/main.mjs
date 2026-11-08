// an ES module imports a name that is a getter of what the file exports, written in the literal and laid by a descriptor
// Under: --aot-testing=CheckProofsAtRunTime: what a read of a variable of the face finds is held against what Link says of it
import { written, laid } from "./box.cjs";
let out = "";
for (let i = 0; i < 3; i++) out += written(i) + laid(i) + ";";
console.log(out);
