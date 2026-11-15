import { Vessel } from "./vessel.mjs";
function rounded(liters) { return Math.round(liters * 10) / 10; }
class Jug extends Vessel {
  constructor(liters) { super(rounded(liters * 1.5)); this.handle = true; }
  describe() { return "jug of " + this.liters + (this.handle ? " with a handle" : ""); }
}
export function make(liters) { return new Jug(liters); }
