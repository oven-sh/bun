import type { int32 } from "bun";
class Dial { at: int32 | 0.5 = 1 }
const dial = new Dial();
const seen = [dial.at];
dial.at = 0.5;
seen.push(dial.at);
dial.at = 7;
seen.push(dial.at);
console.log(seen.join());
