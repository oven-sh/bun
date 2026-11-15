import { make } from "./maker.mjs";
let seen;
try {
  seen = make().mode;
} catch (error) {
  seen = error.name;
}
console.log(seen);
var warm = true;
export class Gauge {
  mode = warm ? "late" : "early";
}
console.log(new Gauge().mode);
