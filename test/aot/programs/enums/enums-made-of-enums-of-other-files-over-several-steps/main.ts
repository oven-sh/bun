import { Base } from "./base";
import { Made } from "./made";
import { Third } from "./third";

console.log(Base.One, Base.Two, Base.Name);
console.log(Made.Three, Made.Four, Made.Name, Made.Length);
console.log(Third.Eight, Third.Nine, Third.Name);
console.log(Third.Eight === 8 ? "eight" : "other", Third["Nine"] + Made["Three"]);
